import type { Trip } from '../schema/trip';

const DAY_MS = 86_400_000;

/** ISO date + n days, in UTC so DST never shifts the day. */
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

export const nights = (trip: Trip) => daysBetween(trip.stay.start, trip.stay.end);

/** Days shown on the charts: a week of context before and after the stay. */
export function windowDates(trip: Trip, before = 7, after = 6): { start: string; end: string; days: string[] } {
  const start = addDays(trip.stay.start, -before);
  const end = addDays(trip.stay.end, after);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d.slice(5));
  return { start, end, days };
}

/** Calendar days of the stay (night of the 16th to the morning of the 23rd = 16..22), as MM-DD. */
export function stayDays(trip: Trip): string[] {
  const out: string[] = [];
  for (let d = trip.stay.start; d < trip.stay.end; d = addDays(d, 1)) out.push(d.slice(5));
  return out;
}

/** The last n complete calendar years before `now`. */
export function historyYears(now: Date, n: number): number[] {
  const y = now.getUTCFullYear();
  return Array.from({ length: n }, (_, i) => y - n + i);
}

/** Forecast is only worth showing when the stay is at most 14 days away (and not over). */
export function forecastWanted(now: Date, trip: Trip): boolean {
  const today = now.toISOString().slice(0, 10);
  return today >= addDays(trip.stay.start, -14) && today < trip.stay.end;
}
