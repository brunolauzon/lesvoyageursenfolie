import { z } from 'zod';
import { httpJson } from '../../lib/http';
import type { Candidate, SearchInput } from './types';

const ResponseSchema = z.object({
  places: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.object({ text: z.string() }).optional(),
        formattedAddress: z.string().optional(),
        location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
        websiteUri: z.string().optional(),
        types: z.array(z.string()).optional(),
        addressComponents: z.array(z.object({ longText: z.string().optional(), types: z.array(z.string()) })).optional(),
      }),
    )
    .optional(),
});

const LODGING_TYPES = new Set(['lodging', 'hotel', 'resort_hotel']);

export async function searchGoogle(input: SearchInput): Promise<Candidate[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];
  const raw = await httpJson('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.websiteUri,places.types,places.addressComponents',
    },
    body: JSON.stringify({
      textQuery: input.location ? `${input.name}, ${input.location}` : input.name,
      maxResultCount: 5,
      languageCode: 'en',
    }),
    ttlMs: 7 * 86_400_000,
  });
  const out: Candidate[] = [];
  for (const p of ResponseSchema.parse(raw).places ?? []) {
    if (!p.location || !p.displayName) continue;
    out.push({
      provider: 'google',
      name: p.displayName.text,
      lat: p.location.latitude,
      lon: p.location.longitude,
      address: p.formattedAddress ?? null,
      country: p.addressComponents?.find((c) => c.types.includes('country'))?.longText ?? null,
      website: p.websiteUri ?? null,
      googlePlaceId: p.id,
      wikidataId: null,
      lodging: (p.types ?? []).some((t) => LODGING_TYPES.has(t)),
    });
  }
  return out;
}
