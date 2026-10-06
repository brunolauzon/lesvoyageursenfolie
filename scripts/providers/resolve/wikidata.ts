import { z } from 'zod';
import { httpJson } from '../../lib/http';
import type { Candidate, SearchInput } from './types';

const API = 'https://www.wikidata.org/w/api.php';
const TTL = 7 * 86_400_000;
const INSTANCE_OF_LODGING = new Set(['Q27686' /* hotel */, 'Q875157' /* resort */]);

const SearchSchema = z.object({ search: z.array(z.object({ id: z.string() })) });
const ClaimSchema = z.array(z.object({ mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).optional() }) }));
const EntitiesSchema = z.object({
  entities: z.record(
    z.string(),
    z.object({
      labels: z.record(z.string(), z.object({ value: z.string() })).optional(),
      claims: z.record(z.string(), ClaimSchema).optional(),
    }),
  ),
});
const CoordSchema = z.object({ latitude: z.number(), longitude: z.number() });
const EntityIdSchema = z.object({ id: z.string() });

export async function searchWikidata(input: SearchInput): Promise<Candidate[]> {
  const search = new URLSearchParams({
    action: 'wbsearchentities', search: input.name, language: 'en', uselang: 'en', type: 'item', limit: '5', format: 'json',
  });
  const { search: hits } = SearchSchema.parse(await httpJson(`${API}?${search}`, { ttlMs: TTL }));
  if (hits.length === 0) return [];

  const get = new URLSearchParams({
    action: 'wbgetentities', ids: hits.map((h) => h.id).join('|'), props: 'claims|labels', languages: 'en', format: 'json',
  });
  const { entities } = EntitiesSchema.parse(await httpJson(`${API}?${get}`, { ttlMs: TTL }));

  const out: Candidate[] = [];
  for (const [id, entity] of Object.entries(entities)) {
    const coord = CoordSchema.safeParse(entity.claims?.P625?.[0]?.mainsnak.datavalue?.value);
    const label = entity.labels?.en?.value;
    if (!coord.success || !label) continue; // no coordinates = can't place it on a map
    const website = z.string().safeParse(entity.claims?.P856?.[0]?.mainsnak.datavalue?.value);
    const kinds = (entity.claims?.P31 ?? []).map((c) => EntityIdSchema.safeParse(c.mainsnak.datavalue?.value));
    out.push({
      provider: 'wikidata',
      name: label,
      lat: coord.data.latitude,
      lon: coord.data.longitude,
      address: null,
      country: null,
      website: website.success ? website.data : null,
      googlePlaceId: null,
      wikidataId: id,
      lodging: kinds.some((k) => k.success && INSTANCE_OF_LODGING.has(k.data.id)),
    });
  }
  return out;
}
