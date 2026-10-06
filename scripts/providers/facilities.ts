/**
 * Facilities: runs each source in priority order and stores the raw result per source.
 * Merging with overrides happens at load time (src/lib/merge.ts), so editing an override needs no refetch.
 * A source that fails keeps its previous result. Google is not a source here: its terms forbid caching content.
 */
import { mergeFacilities, missingKeys } from '../../src/lib/merge';
import { FacilitiesCacheSchema, type FacilitiesCache, type Photo, type ProviderResult } from '../../src/schema/facilities';
import type { CacheProvider, ProviderCtx } from '../lib/provider';
import { TTL_DAYS } from '../lib/ttl';
import { llm } from './facilities/llm';
import { officialSite } from './facilities/official';
import { osm } from './facilities/osm';
import { wikidata } from './facilities/wikidata';

const MAX_PHOTOS = 6;
const warn = (name: string, err: unknown) => console.warn(`[facilities] ${name} failed: ${err instanceof Error ? err.message : err}`);

export const facilitiesProvider: CacheProvider<FacilitiesCache> = {
  name: 'facilities',
  file: 'facilities.json',
  ttlDays: () => TTL_DAYS.facilities,
  fingerprint: ({ meta, entry }) =>
    JSON.stringify([
      meta.resolved.lat.toFixed(3), meta.resolved.lon.toFixed(3), entry.url ?? meta.resolved.website, meta.resolved.wikidataId,
      Boolean(process.env.ANTHROPIC_API_KEY),
    ]),
  parse: (json) => FacilitiesCacheSchema.parse(json),

  async run(ctx: ProviderCtx, previous) {
    const now = ctx.now.toISOString();
    const providers: Record<string, ProviderResult> = { ...previous?.providers };
    const photos: Record<'official' | 'wikimedia', Photo[]> = {
      official: previous?.photos.filter((p) => p.source === 'official') ?? [],
      wikimedia: previous?.photos.filter((p) => p.source === 'wikimedia') ?? [],
    };
    let pages = previous?.pages ?? [];
    let officialText = '';

    try {
      const r = await officialSite(ctx);
      providers.official = { fetchedAt: now, fields: r.fields };
      photos.official = r.photos ?? [];
      pages = r.pages;
      officialText = r.text;
    } catch (err) {
      warn('official site', err);
    }
    try {
      const r = await osm(ctx);
      providers.osm = { fetchedAt: now, fields: r.fields };
    } catch (err) {
      warn('OpenStreetMap', err);
    }
    try {
      const r = await wikidata(ctx);
      providers.wikidata = { fetchedAt: now, fields: r.fields };
      photos.wikimedia = r.photos ?? [];
    } catch (err) {
      warn('Wikidata/Commons', err);
    }

    // Last resort, behind the key: only the fields nothing else (including hand-written overrides) could fill.
    if (process.env.ANTHROPIC_API_KEY && officialText) {
      try {
        const { llm: _drop, ...withoutLlm } = providers;
        const missing = missingKeys(mergeFacilities(withoutLlm, {}, ctx.override));
        const fields = await llm(officialText, missing, pages[0] ?? null);
        providers.llm = { fetchedAt: now, fields };
        console.log(`[facilities] ${ctx.entry.slug}: LLM filled ${Object.keys(fields).length} of ${missing.length} missing fields`);
      } catch (err) {
        warn('LLM', err);
      }
    }

    const unique = new Map<string, Photo>();
    for (const p of [...photos.official, ...photos.wikimedia.filter((p) => p.verified), ...photos.wikimedia.filter((p) => !p.verified)]) unique.set(p.url, p);

    return { fetchedAt: now, fingerprint: this.fingerprint(ctx), providers, photos: [...unique.values()].slice(0, MAX_PHOTOS), pages };
  },
};
