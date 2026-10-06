// How recent a resort feels: when it opened, when it was last renovated, and how long ago that was at departure.
import type { Resort } from './resorts';

/** Departure, 16 January 2027, as a decimal year. */
export const TRIP_YEAR = 2027 + 15 / 365;

const at = (year: number | null | undefined, month: number | null | undefined) => (year == null ? null : year + ((month ?? 6) - 1) / 12);

export interface Freshness {
  open: number | null;
  renovated: number | null;
  /** The more recent of opening and last renovation. */
  lastYear: number;
  lastKind: 'renovation' | 'ouverture';
  /** Years between that date and the departure. */
  age: number;
  /** Plain words for the age. */
  label: 'Très récent' | 'Récent' | 'Plus ancien' | 'À confirmer';
  /** The work is announced but not done yet. */
  planned: boolean;
  alerte: string | null;
  note: string | null;
  works: string | null;
}

export function freshnessOf(r: Resort): Freshness | null {
  const e = r.etat;
  if (!e) return null;
  const open = e.ouvertureAnnee ?? null;
  const renovated = e.renovationAnnee ?? null;
  const o = at(open, e.ouvertureMois);
  const n = at(renovated, e.renovationMois);
  const last = Math.max(o ?? -Infinity, n ?? -Infinity);
  if (!Number.isFinite(last)) return null;
  const age = TRIP_YEAR - last;
  return {
    open,
    renovated,
    lastYear: Math.floor(last),
    lastKind: n != null && n >= (o ?? -Infinity) ? 'renovation' : 'ouverture',
    age,
    label: e.prevu ? 'À confirmer' : age <= 3 ? 'Très récent' : age <= 6 ? 'Récent' : 'Plus ancien',
    planned: Boolean(e.prevu),
    alerte: e.alerte ?? null,
    note: e.note ?? null,
    works: e.renovationNote ?? null,
  };
}

/** "il y a 2 ans", "il y a moins d’un an". */
export function agoLabel(age: number): string {
  const y = Math.round(age);
  return y < 1 ? 'il y a moins d’un an' : `il y a ${y} an${y > 1 ? 's' : ''}`;
}

/** Short chip text: "Rénové en 2024" or "Ouvert en 2018". */
export function chipLabel(f: Freshness): string {
  if (f.planned) return `Réouverture prévue ${f.lastYear}`;
  return f.lastKind === 'renovation' ? `Rénové en ${f.lastYear}` : `Ouvert en ${f.lastYear}`;
}
