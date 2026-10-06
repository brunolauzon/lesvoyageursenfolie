import { slugify } from '../../src/lib/slugify';

/** Words that carry no identity: "Hotel Riu Palace" and "Riu Palace" are the same place. */
const STOPWORDS = new Set([
  'hotel', 'hotels', 'resort', 'resorts', 'spa', 'the', 'de', 'del', 'la', 'el', 'by', 'and', 'all', 'inclusive', 'club',
]);

export function nameTokens(name: string): string[] {
  const all = [...new Set(slugify(name).split('-').filter(Boolean))];
  const meaningful = all.filter((t) => !STOPWORDS.has(t));
  return meaningful.length ? meaningful : all;
}

/** 0..1. Mean of Dice overlap (penalises extra words) and query coverage (penalises missing words). */
export function nameSimilarity(query: string, candidate: string): number {
  const q = nameTokens(query);
  const c = new Set(nameTokens(candidate));
  if (!q.length || !c.size) return 0;
  const shared = q.filter((t) => c.has(t)).length;
  const dice = (2 * shared) / (q.length + c.size);
  const coverage = shared / q.length;
  return (dice + coverage) / 2;
}

export function sameHost(a: string, b: string): boolean {
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return null;
    }
  };
  const ha = host(a);
  return ha !== null && ha === host(b);
}

export interface Matchable {
  name: string;
  lodging: boolean;
  website: string | null;
}

/** Confidence 0..1. Non-lodging places are capped at 0.75, so a wrong kind of place can't win on name alone. */
export function scoreCandidate(c: Matchable, input: { name: string; url?: string | undefined }): number {
  let conf = nameSimilarity(input.name, c.name) * (c.lodging ? 1 : 0.75);
  if (input.url && c.website && sameHost(input.url, c.website)) conf += 0.1;
  return Math.round(Math.min(1, conf) * 100) / 100;
}
