import { getCollection, type CollectionEntry } from 'astro:content';

export type Resort = CollectionEntry<'resorts'>['data'];

export async function getResorts(): Promise<Resort[]> {
  const entries = await getCollection('resorts');
  return entries.map((e) => e.data);
}

// Country shown in the matrix: manual override first, else the last part of "City, Country".
export const countryOf = (r: Resort): string | null => r.pays ?? r.destination?.split(',').at(-1)?.trim() ?? null;

// "Punta Cana, République dominicaine" -> "Punta Cana"; null when the label is only a country.
export function cityOf(r: Resort): string | null {
  const parts = r.destination?.split(',').map((s) => s.trim()) ?? [];
  return parts.length > 1 ? parts.slice(0, -1).join(', ') : null;
}

export const totalMinutes = (r: Resort) => r.logistiqueTransport?.tempsTrajetTotalMinutes ?? null;

// Country (A to Z), then input order; resorts with no known country go last. Used for every list on the page.
const collator = new Intl.Collator('fr-CA');
export function orderByCountry(resorts: Resort[]): Resort[] {
  return [...resorts].sort((a, b) => {
    const [ca, cb] = [countryOf(a), countryOf(b)];
    if (ca === cb) return 0;
    if (!ca) return 1;
    if (!cb) return -1;
    return collator.compare(ca, cb);
  });
}
