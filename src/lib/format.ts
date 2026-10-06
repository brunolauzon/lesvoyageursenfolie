// Formatting helpers (fr-CA). Every helper accepts null/undefined and returns a "to confirm" placeholder.

export const TBC = 'À confirmer';

export const TRIP = {
  start: '2027-01-16',
  end: '2027-01-23',
  label: '16 au 23 janvier 2027',
};

// Typical extra time spent in airports (advice, not data): check-in/security before, immigration + bags after.
export const AIRPORT_BUFFER = { departMin: 180, arriveeMin: 45 };

const nf = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 });

export const num = (n: number | null | undefined, unit = '') =>
  n == null ? TBC : `${nf.format(n)}${unit ? ' ' + unit : ''}`;

export function duration(min: number | null | undefined): string {
  if (min == null) return TBC;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export function href(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}

export const dayLabel = (mmdd: string) => {
  const [m, d] = mmdd.split('-').map(Number);
  return `${d} ${['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][m - 1]}`;
};

export const dateFr = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
