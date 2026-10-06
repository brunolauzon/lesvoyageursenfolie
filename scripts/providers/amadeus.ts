/** Fastest itinerary and cheapest price from Amadeus Self-Service. Only used when keys are set. */
import { z } from 'zod';
import { httpJson } from '../lib/http';

const HOST = process.env.AMADEUS_HOST ?? 'https://test.api.amadeus.com';

const TokenSchema = z.object({ access_token: z.string() });
const OffersSchema = z.object({
  data: z.array(
    z.object({
      itineraries: z.array(z.object({ duration: z.string(), segments: z.array(z.object({ carrierCode: z.string() })) })),
      price: z.object({ grandTotal: z.string() }),
      validatingAirlineCodes: z.array(z.string()).optional(),
    }),
  ),
});

export interface AmadeusFlight {
  minutes: number;
  stops: number;
  carriers: string[];
  /** per person */
  priceCad: number;
}

/** "PT5H30M" -> 330 */
export function isoDurationMinutes(d: string): number {
  const m = d.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!m) throw new Error(`Unexpected duration ${d}`);
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export async function searchAmadeus(o: {
  origin: string;
  destination: string;
  depart: string;
  ret: string;
  adults: number;
  currency: string;
}): Promise<AmadeusFlight | null> {
  const id = process.env.AMADEUS_CLIENT_ID;
  const secret = process.env.AMADEUS_CLIENT_SECRET;
  if (!id || !secret) return null;

  const token = TokenSchema.parse(
    await httpJson(`${HOST}/v1/security/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }).toString(),
      cache: false, // never write the token to disk
    }),
  );
  const params = new URLSearchParams({
    originLocationCode: o.origin, destinationLocationCode: o.destination, departureDate: o.depart, returnDate: o.ret,
    adults: String(o.adults), currencyCode: o.currency, max: '20',
  });
  const { data } = OffersSchema.parse(
    await httpJson(`${HOST}/v2/shopping/flight-offers?${params}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      ttlMs: 6 * 3600_000,
    }),
  );
  if (!data.length) return null;

  const outbound = (offer: (typeof data)[number]) => isoDurationMinutes(offer.itineraries[0]!.duration);
  const fastest = data.reduce((a, b) => (outbound(b) < outbound(a) ? b : a));
  const cheapest = Math.min(...data.map((d) => Number(d.price.grandTotal)));
  const segments = fastest.itineraries[0]!.segments;
  return {
    minutes: outbound(fastest),
    stops: segments.length - 1,
    carriers: fastest.validatingAirlineCodes ?? [...new Set(segments.map((s) => s.carrierCode))],
    priceCad: Math.round(cheapest / o.adults),
  };
}
