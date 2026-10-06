import type { Travel } from '../schema/travel';
import type { Trip } from '../schema/trip';
import { haversineKm, type LatLon } from './geo';

export const SEARCH_RADIUS_KM = 150;

export type AirportChoice = Travel['airport']['choice'];

/**
 * Arrival airport for a resort. An override wins; otherwise prefer the nearest airport that has
 * flights from YUL (curated list) within the search radius; otherwise the nearest one at all.
 */
export function pickAirport<A extends LatLon & { iata: string }>(
  resort: LatLon,
  airports: A[],
  withFlights: Set<string>,
  override?: string,
): { airport: A; distanceKm: number; choice: AirportChoice } {
  const ranked = airports.map((a) => ({ airport: a, distanceKm: haversineKm(resort, a) })).sort((a, b) => a.distanceKm - b.distanceKm);
  if (override) {
    const hit = ranked.find((r) => r.airport.iata === override.toUpperCase());
    if (!hit) throw new Error(`Unknown airport "${override}" (see data/reference/airports.csv)`);
    return { ...hit, choice: 'override' };
  }
  const served = ranked.find((r) => withFlights.has(r.airport.iata) && r.distanceKm <= SEARCH_RADIUS_KM);
  if (served) return { ...served, choice: 'nearest-with-flights' };
  const nearest = ranked[0];
  if (!nearest) throw new Error('No airports available');
  return { ...nearest, choice: 'nearest' };
}

export interface DoorToDoor {
  home: number;
  checkin: number;
  flight: number;
  arrival: number;
  /** road time including the safety margin */
  transfer: number;
  total: number;
}

/** Door-to-door minutes. Buffers and margin come from trip.yml, so changing them needs no refetch. */
export function doorToDoor(travel: Travel, cfg: Trip['travel']): DoorToDoor {
  const home = cfg.home_to_airport_min;
  const checkin = cfg.checkin_buffer_min;
  const flight = travel.flight.minutes;
  const arrival = cfg.arrival_buffer_min;
  const transfer = Math.round(travel.transfer.minutes * (1 + cfg.transfer_margin_pct / 100));
  return { home, checkin, flight, arrival, transfer, total: home + checkin + flight + arrival + transfer };
}

/** No schedule available: great-circle at cruise speed plus taxi, climb and approach. */
export const estimateFlightMinutes = (km: number) => Math.round((km / 800) * 60 + 30);

/** No route available: straight line at 50 km/h. */
export const estimateTransferMinutes = (km: number) => Math.round((km / 50) * 60);

/** "7 h 05" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
