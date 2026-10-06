/**
 * Arrival airport, flight time, ground transfer and time zone for each resort.
 * Flight time: curated list -> Amadeus -> estimate. Transfer: OpenRouteService -> OSRM -> estimate.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { haversineKm } from '../../src/lib/geo';
import { loadAirports, loadFlightTimes } from '../../src/lib/reference';
import { estimateFlightMinutes, estimateTransferMinutes, pickAirport } from '../../src/lib/travel';
import { utcOffsetHours } from '../../src/lib/tz';
import { TravelSchema, type Travel } from '../../src/schema/travel';
import { httpJson } from '../lib/http';
import type { CacheProvider, ProviderCtx } from '../lib/provider';
import { TTL_DAYS } from '../lib/ttl';
import { searchAmadeus } from './amadeus';

const RouteSchema = z.object({ routes: z.array(z.object({ duration: z.number(), distance: z.number() })).min(1) });
const OrsSchema = z.object({ features: z.array(z.object({ properties: z.object({ summary: z.object({ duration: z.number(), distance: z.number() }) }) })).min(1) });
const TzSchema = z.object({ timezone: z.string() });

const refFile = (name: string) => readFileSync(join(process.cwd(), 'data', 'reference', name), 'utf8');

async function route(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<Travel['transfer']> {
  const key = process.env.ORS_API_KEY;
  try {
    if (key) {
      const res = OrsSchema.parse(
        await httpJson(`https://api.openrouteservice.org/v2/directions/driving-car?start=${from.lon},${from.lat}&end=${to.lon},${to.lat}`, {
          headers: { Authorization: key },
          ttlMs: 30 * 86_400_000,
        }),
      ).features[0]!.properties.summary;
      return { minutes: Math.round(res.duration / 60), km: Math.round(res.distance / 100) / 10, estimated: false, source: 'openrouteservice' };
    }
    const res = RouteSchema.parse(
      await httpJson(`https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`, {
        ttlMs: 30 * 86_400_000,
      }),
    ).routes[0]!;
    return { minutes: Math.round(res.duration / 60), km: Math.round(res.distance / 100) / 10, estimated: false, source: 'osrm' };
  } catch (err) {
    console.warn(`[travel] routing failed, using straight-line estimate: ${err instanceof Error ? err.message : err}`);
    const km = Math.round(haversineKm(from, to) * 10) / 10;
    return { minutes: estimateTransferMinutes(km), km, estimated: true, source: 'estimate' };
  }
}

async function zone(lat: number, lon: number): Promise<string> {
  const q = new URLSearchParams({ latitude: String(lat), longitude: String(lon), daily: 'temperature_2m_max', forecast_days: '1', timezone: 'auto' });
  return TzSchema.parse(await httpJson(`https://api.open-meteo.com/v1/forecast?${q}`, { ttlMs: 365 * 86_400_000 })).timezone;
}

export const travelProvider: CacheProvider<Travel> = {
  name: 'travel',
  file: 'travel.json',
  ttlDays: () => TTL_DAYS.travel,
  fingerprint: ({ meta, trip, override }) =>
    JSON.stringify([
      meta.resolved.lat.toFixed(3), meta.resolved.lon.toFixed(3), override?.airport ?? null, trip.stay.start, trip.stay.end, trip.travelers,
      Boolean(process.env.AMADEUS_CLIENT_ID), createHash('sha256').update(refFile('flight-times.yml')).digest('hex').slice(0, 8),
    ]),
  parse: (json) => TravelSchema.parse(json),

  async run(ctx: ProviderCtx) {
    const { lat, lon } = ctx.meta.resolved;
    const flightTimes = loadFlightTimes();
    const picked = pickAirport({ lat, lon }, loadAirports(), new Set(flightTimes.map((f) => f.airport)), ctx.override?.airport);
    const a = picked.airport;
    const greatCircleKm = Math.round(haversineKm(ctx.trip.origin, a));

    // Flight: curated nonstop time first, then Amadeus, then an estimate. Amadeus also supplies a price.
    const curated = flightTimes.find((f) => f.airport === a.iata);
    let amadeus = null;
    try {
      amadeus = await searchAmadeus({
        origin: ctx.trip.origin.airport, destination: a.iata, depart: ctx.trip.stay.start, ret: ctx.trip.stay.end,
        adults: ctx.trip.travelers, currency: ctx.trip.currency,
      });
    } catch (err) {
      console.warn(`[travel] Amadeus failed: ${err instanceof Error ? err.message : err}`);
    }

    const flight: Travel['flight'] = curated
      ? { minutes: curated.minutes, stops: 0, carriers: curated.carriers, source: 'curated', estimated: false, greatCircleKm, priceCad: amadeus?.priceCad ?? null, note: curated.note ?? null, sourceUrl: curated.source ?? null }
      : amadeus
        ? { minutes: amadeus.minutes, stops: amadeus.stops, carriers: amadeus.carriers, source: 'amadeus', estimated: false, greatCircleKm, priceCad: amadeus.priceCad, note: null, sourceUrl: null }
        : { minutes: estimateFlightMinutes(greatCircleKm), stops: 0, carriers: [], source: 'estimate', estimated: true, greatCircleKm, priceCad: null, note: null, sourceUrl: null };

    const transfer = await route(a, { lat, lon });

    let timezone: Travel['timezone'];
    try {
      const [dest, origin] = await Promise.all([zone(lat, lon), zone(ctx.trip.origin.lat, ctx.trip.origin.lon)]);
      const at = new Date(`${ctx.trip.stay.start}T12:00:00Z`);
      timezone = { name: dest, originName: origin, diffHours: utcOffsetHours(dest, at) - utcOffsetHours(origin, at) };
    } catch (err) {
      throw new Error(`time zone lookup failed: ${err instanceof Error ? err.message : err}`);
    }

    return {
      fetchedAt: ctx.now.toISOString(),
      fingerprint: this.fingerprint(ctx),
      airport: { iata: a.iata, name: a.name, lat: a.lat, lon: a.lon, country: a.country, municipality: a.municipality, distanceToResortKm: Math.round(picked.distanceKm * 10) / 10, choice: picked.choice },
      flight,
      transfer,
      timezone,
    };
  },
};
