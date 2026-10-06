/**
 * Turns a hotel name into a canonical record. Order: Google Places (if key) -> Nominatim -> Wikidata.
 * The only step allowed to fail the build (below MIN_CONFIDENCE a wrong hotel must never ship silently).
 */
import { createHash } from 'node:crypto';
import type { ResortEntry } from '../../src/lib/data';
import type { Meta, Resolved } from '../../src/schema/meta';
import { haversineKm } from '../lib/geo';
import { scoreCandidate } from '../lib/match';
import { searchGoogle } from './resolve/google';
import { searchNominatim } from './resolve/nominatim';
import { searchWikidata } from './resolve/wikidata';
import type { Candidate, SearchInput } from './resolve/types';

export const MIN_CONFIDENCE = 0.6;
/** Candidates from other providers within this radius of the winner are treated as the same place. */
const MERGE_RADIUS_KM = 5;

export type Scored = Candidate & { confidence: number };

export class ResolveError extends Error {
  constructor(
    message: string,
    readonly kind: 'no-match' | 'low-confidence' | 'network',
  ) {
    super(message);
    this.name = 'ResolveError';
  }
}

export function hashInput(input: SearchInput): string {
  return createHash('sha256')
    .update(JSON.stringify([input.name, input.location ?? null, input.url ?? null]))
    .digest('hex')
    .slice(0, 12);
}

const hint = (name: string) =>
  `Fix: add \`location:\` (e.g. "Varadero, Cuba") or \`url:\` (official website) to the "${name}" entry in data/resorts.yml.`;

/** Pure: picks the winner among scored candidates and merges the others into it. */
export function buildMeta(entry: ResortEntry, scored: Scored[], now: string, providerErrors: string[] = []): Meta {
  const sorted = [...scored].sort((a, b) => b.confidence - a.confidence); // stable: ties keep provider priority
  const best = sorted[0];

  if (!best) {
    if (providerErrors.length) {
      throw new ResolveError(`Could not reach any provider for "${entry.name}":\n  ${providerErrors.join('\n  ')}`, 'network');
    }
    throw new ResolveError(`No place found for "${entry.name}".\n${hint(entry.name)}`, 'no-match');
  }
  if (best.confidence < MIN_CONFIDENCE) {
    const top = sorted.slice(0, 3).map((c) => `  - "${c.name}" via ${c.provider} (${c.confidence})`).join('\n');
    const errors = providerErrors.length ? `\n  Provider errors (result may be incomplete):\n  ${providerErrors.join('\n  ')}` : '';
    throw new ResolveError(
      `Cannot confidently identify "${entry.name}" (best confidence ${best.confidence}, need >= ${MIN_CONFIDENCE}).\n` +
        `Closest matches:\n${top}${errors}\n${hint(entry.name)}`,
      providerErrors.length ? 'network' : 'low-confidence',
    );
  }

  const same = sorted.filter((c) => c !== best && c.confidence >= MIN_CONFIDENCE && haversineKm(best, c) <= MERGE_RADIUS_KM);
  const sources = [best, ...same];

  // Google only allows short-lived caching of coordinates: prefer an open source for lat/lon when one agrees.
  const coordSource = best.provider === 'google' ? (same.find((c) => c.provider !== 'google') ?? best) : best;

  const fields: Meta['fields'] = {};
  const take = <T>(key: string, from: Scored | undefined, value: T | null | undefined): T | null => {
    if (value == null || !from) return null;
    fields[key] = { source: from.provider, confidence: from.confidence, fetchedAt: now };
    return value;
  };
  const first = <K extends 'address' | 'country' | 'website' | 'googlePlaceId' | 'wikidataId'>(key: K) => {
    const from = sources.find((c) => c[key] != null);
    return take(key, from, from?.[key]);
  };

  const resolved: Resolved = {
    name: take('name', best, best.name)!,
    lat: take('lat', coordSource, coordSource.lat)!,
    lon: take('lon', coordSource, coordSource.lon)!,
    address: first('address'),
    country: first('country'),
    website: first('website'),
    googlePlaceId: first('googlePlaceId'),
    wikidataId: first('wikidataId'),
  };

  const alternatives = sorted
    .filter((c) => !sources.includes(c))
    .slice(0, 5)
    .map((c) => ({ provider: c.provider, name: c.name, lat: c.lat, lon: c.lon, address: c.address, confidence: c.confidence }));

  return {
    slug: entry.slug,
    inputHash: hashInput(entry),
    fetchedAt: now,
    provider: best.provider,
    confidence: best.confidence,
    resolved,
    fields,
    alternatives,
  };
}

const SOURCES: { name: string; enabled: () => boolean; search: (i: SearchInput) => Promise<Candidate[]> }[] = [
  { name: 'google', enabled: () => Boolean(process.env.GOOGLE_PLACES_API_KEY), search: searchGoogle },
  { name: 'nominatim', enabled: () => true, search: searchNominatim },
  { name: 'wikidata', enabled: () => true, search: searchWikidata },
];

export async function resolveResort(entry: ResortEntry): Promise<Meta> {
  const scored: Scored[] = [];
  const errors: string[] = [];
  for (const source of SOURCES) {
    if (!source.enabled()) continue;
    try {
      for (const c of await source.search(entry)) scored.push({ ...c, confidence: scoreCandidate(c, entry) });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[resolve] ${source.name} failed for "${entry.name}": ${reason}`);
      errors.push(`${source.name}: ${reason}`);
    }
  }
  return buildMeta(entry, scored, new Date().toISOString(), errors);
}
