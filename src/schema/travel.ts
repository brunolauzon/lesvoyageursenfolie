import { z } from 'zod';

export const FlightTimeSchema = z.object({
  airport: z.string().length(3),
  minutes: z.number().positive(),
  carriers: z.array(z.string()).default([]),
  note: z.string().optional(),
  source: z.string().optional(),
  checked: z.string().optional(),
});
export const FlightTimesSchema = z.array(FlightTimeSchema);
export type FlightTime = z.infer<typeof FlightTimeSchema>;

export const AirportSchema = z.object({
  iata: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  country: z.string(),
  municipality: z.string(),
});
export type Airport = z.infer<typeof AirportSchema>;

/** data/cache/<slug>/travel.json. Raw facts; buffers and margins from trip.yml are applied at render. */
export const TravelSchema = z.object({
  fetchedAt: z.iso.datetime(),
  fingerprint: z.string(),
  airport: AirportSchema.extend({
    distanceToResortKm: z.number(),
    choice: z.enum(['override', 'nearest-with-flights', 'nearest']),
  }),
  flight: z.object({
    minutes: z.number(),
    stops: z.number().int().nonnegative(),
    carriers: z.array(z.string()),
    source: z.enum(['curated', 'amadeus', 'estimate']),
    estimated: z.boolean(),
    greatCircleKm: z.number(),
    /** per person, CAD, from Amadeus when keys are set */
    priceCad: z.number().nullable(),
    note: z.string().nullable(),
    sourceUrl: z.string().nullable(),
  }),
  transfer: z.object({
    /** raw routing time, before the safety margin */
    minutes: z.number(),
    km: z.number(),
    estimated: z.boolean(),
    source: z.enum(['openrouteservice', 'osrm', 'estimate']),
  }),
  timezone: z.object({
    name: z.string(),
    originName: z.string(),
    /** hours ahead of Montréal at the stay start (negative = behind) */
    diffHours: z.number(),
  }),
});
export type Travel = z.infer<typeof TravelSchema>;
