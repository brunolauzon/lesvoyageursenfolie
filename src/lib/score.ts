/** "Which one should we pick?" scoring. Pure functions shared by the build and the browser. */
import { normalize } from './compare';

export interface Sub {
  key: string;
  label: string;
  dir: 'high' | 'low';
  values: Record<string, number | null>;
}
export interface Criterion {
  key: string;
  label: string;
  subs: Sub[];
}

export type Weights = Record<string, number>;

export interface ResortScore {
  slug: string;
  /** 0..100, or null when no weighted criterion has data */
  total: number | null;
  /** normalized 0..1 per criterion, null when no data */
  perCriterion: Record<string, number | null>;
  /** points each criterion adds to the total */
  points: Record<string, number>;
  /** weighted criteria with no data for this resort: their weight was redistributed */
  missing: string[];
}

/**
 * Each sub-metric is min-max normalized across the selected resorts (best = 1), then averaged within
 * its criterion. A resort missing every sub-metric of a criterion is excluded from that criterion and
 * its weight is spread over the criteria it does have. Sorted best first.
 */
export function computeScores(criteria: Criterion[], slugs: string[], weights: Weights): ResortScore[] {
  const normalizedByCriterion = criteria.map((c) => {
    const subs = c.subs.map((s) => normalize(slugs.map((slug) => s.values[slug] ?? null), s.dir));
    return slugs.map((_, i) => {
      const known = subs.map((s) => s[i]!).filter((v): v is number => v !== null);
      return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
    });
  });

  const scores = slugs.map<ResortScore>((slug, i) => {
    const perCriterion: Record<string, number | null> = {};
    const points: Record<string, number> = {};
    const missing: string[] = [];
    let weightSum = 0;
    criteria.forEach((c, ci) => {
      const v = normalizedByCriterion[ci]![i]!;
      perCriterion[c.key] = v;
      const w = weights[c.key] ?? 0;
      if (w > 0 && v === null) missing.push(c.key);
      if (w > 0 && v !== null) weightSum += w;
    });
    let total: number | null = null;
    if (weightSum > 0) {
      total = 0;
      criteria.forEach((c) => {
        const v = perCriterion[c.key];
        const w = weights[c.key] ?? 0;
        const pts = w > 0 && v !== null && v !== undefined ? (w / weightSum) * v * 100 : 0;
        points[c.key] = pts;
        total! += pts;
      });
    }
    return { slug, total, perCriterion, points, missing };
  });
  return scores.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
}
