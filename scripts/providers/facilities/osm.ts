/** OpenStreetMap via Overpass: tags on the hotel itself, plus beach, pools and nearest town around it. */
import { z } from 'zod';
import { haversineKm, type LatLon } from '../../../src/lib/geo';
import { nameSimilarity } from '../../lib/match';
import { httpJson } from '../../lib/http';
import type { ProviderCtx } from '../../lib/provider';
import type { FactEntry, SubResult } from './types';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const BEACH_RADIUS_M = 2000;
const POOL_RADIUS_M = 250;
const TOWN_RADIUS_M = 40_000;
const BEACHFRONT_M = 150;

const Pt = z.object({ lat: z.number(), lon: z.number() });
const ElementSchema = z.object({
  type: z.string(),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: Pt.optional(),
  geometry: z.array(Pt).optional(),
  members: z.array(z.object({ geometry: z.array(Pt).optional() })).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});
const ResponseSchema = z.object({ elements: z.array(ElementSchema) });
type Element = z.infer<typeof ElementSchema>;

const points = (e: Element): LatLon[] => {
  const pts = [...(e.geometry ?? []), ...(e.members ?? []).flatMap((m) => m.geometry ?? [])];
  if (e.center) pts.push(e.center);
  if (e.lat !== undefined && e.lon !== undefined) pts.push({ lat: e.lat, lon: e.lon });
  return pts;
};
const minDistM = (from: LatLon, e: Element) => Math.min(...points(e).map((p) => haversineKm(from, p) * 1000));

export function buildQuery({ lat, lon }: LatLon): string {
  const around = (r: number) => `(around:${r},${lat},${lon})`;
  return `[out:json][timeout:30];
(nwr${around(250)}[tourism~"^(hotel|resort)$"];);out tags center;
(nwr${around(BEACH_RADIUS_M)}[natural=beach];);out geom tags;
(nwr${around(POOL_RADIUS_M)}[leisure=swimming_pool];);out center tags;
(nwr${around(TOWN_RADIUS_M)}[place~"^(city|town|village)$"];);out tags center;`;
}

export function factsFromElements(elements: Element[], at: LatLon, name: string): Record<string, FactEntry> {
  const out: Record<string, FactEntry> = {};
  const put = (key: string, value: unknown, confidence: number) => {
    if (value !== undefined && !(key in out)) out[key] = { value, confidence, url: 'https://www.openstreetmap.org/copyright' };
  };

  // The hotel itself: only trust tags if the name matches, else we may be reading the neighbour.
  const hotel = elements
    .filter((e) => /^(hotel|resort)$/.test(e.tags?.tourism ?? '') && e.tags?.name && nameSimilarity(name, e.tags.name) >= 0.5)
    .sort((a, b) => nameSimilarity(name, b.tags!.name!) - nameSimilarity(name, a.tags!.name!))[0];
  const tag = hotel?.tags ?? {};
  if (hotel) {
    const stars = Number(tag.stars?.replace(',', '.'));
    if (stars >= 1 && stars <= 5) put('stars', Math.round(stars * 2) / 2, 0.7);
    if (tag.swimming_pool === 'yes') put('hasPool', true, 0.7);
    if (/^(wlan|wifi|yes)$/.test(tag.internet_access ?? '')) {
      if (tag['internet_access:fee'] === 'no') put('wifiFree', true, 0.7);
      else if (tag['internet_access:fee'] === 'yes') put('wifiFree', false, 0.7);
    }
    if (/^(yes|designated)$/.test(tag.wheelchair ?? '')) put('wheelchair', true, 0.7);
    if (tag.wheelchair === 'no') put('wheelchair', false, 0.7);
    const rooms = Number(tag.rooms);
    if (rooms > 0) put('roomCount', rooms, 0.7);
  }

  // Beach: distance from the hotel to the nearest mapped beach geometry. Approximate by nature.
  const beaches = elements.filter((e) => e.tags?.natural === 'beach' && points(e).length);
  if (beaches.length) {
    const nearest = beaches.map((e) => ({ e, d: minDistM(at, e) })).sort((a, b) => a.d - b.d)[0]!;
    put('beachDistanceM', Math.round(nearest.d / 10) * 10, 0.5);
    put('beachfront', nearest.d <= BEACHFRONT_M, 0.5);
    const surface = nearest.e.tags?.surface;
    if (surface === 'sand') put('beachType', 'sand', 0.5);
    else if (surface && /^(pebbles?|gravel|shingle)$/.test(surface)) put('beachType', 'pebble', 0.5);
    else if (surface && /^(rock|rocks|stone)$/.test(surface)) put('beachType', 'rock', 0.5);
  }

  // Mapped pools inside the property. A lower bound: unmapped pools are invisible to us.
  const pools = elements.filter((e) => e.tags?.leisure === 'swimming_pool' && e.tags.access !== 'private' && points(e).length);
  if (pools.length) {
    put('poolCount', pools.length, 0.4);
    put('hasPool', true, 0.5);
  }

  const towns = elements.filter((e) => /^(city|town|village)$/.test(e.tags?.place ?? '') && points(e).length);
  const townKm = towns.map((e) => minDistM(at, e) / 1000).filter((km) => km >= 0.3);
  if (townKm.length) put('nearestTownKm', Math.round(Math.min(...townKm) * 10) / 10, 0.6);
  return out;
}

export async function osm(ctx: ProviderCtx): Promise<SubResult> {
  const { lat, lon, name } = ctx.meta.resolved;
  const raw = await httpJson(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: buildQuery({ lat, lon }) }).toString(),
    ttlMs: 14 * 86_400_000,
    intervalMs: 2000,
  });
  return { fields: factsFromElements(ResponseSchema.parse(raw).elements, { lat, lon }, name) };
}
