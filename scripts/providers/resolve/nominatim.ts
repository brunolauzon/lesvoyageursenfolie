import { z } from 'zod';
import { httpJson } from '../../lib/http';
import type { Candidate, SearchInput } from './types';

const RowSchema = z.object({
  name: z.string().optional(),
  display_name: z.string(),
  lat: z.string(),
  lon: z.string(),
  category: z.string().optional(),
  type: z.string().optional(),
  address: z.object({ country: z.string().optional() }).partial().optional(),
  extratags: z.record(z.string(), z.string()).optional(),
});

const LODGING_TYPES = new Set(['hotel', 'resort', 'motel', 'guest_house', 'hostel', 'apartment', 'chalet']);

export async function searchNominatim(input: SearchInput): Promise<Candidate[]> {
  const queries = input.location ? [`${input.name}, ${input.location}`, input.name] : [input.name];
  for (const q of queries) {
    const params = new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', extratags: '1', limit: '5' });
    const raw = await httpJson(`https://nominatim.openstreetmap.org/search?${params}`, { ttlMs: 7 * 86_400_000 });
    const rows = z.array(RowSchema).parse(raw);
    if (rows.length === 0) continue;
    return rows.map((r) => ({
      provider: 'nominatim' as const,
      name: r.name || r.display_name.split(',')[0]!.trim(),
      lat: Number(r.lat),
      lon: Number(r.lon),
      address: r.display_name,
      country: r.address?.country ?? null,
      website: r.extratags?.website ?? r.extratags?.['contact:website'] ?? null,
      googlePlaceId: null,
      wikidataId: r.extratags?.wikidata ?? null,
      lodging: (r.category === 'tourism' || r.category === 'building') && LODGING_TYPES.has(r.type ?? ''),
    }));
  }
  return [];
}
