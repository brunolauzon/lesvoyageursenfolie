/** Best/worst highlighting and "differences only", shared by the build and the browser. */

export type Dir = 'high' | 'low' | null;

export interface Rank {
  best: Set<number>;
  worst: Set<number>;
}

/**
 * Indexes of the best and worst scores. Rows where fewer than two distinct scores exist have no
 * best or worst (nothing to compare). Null scores are ignored.
 */
export function rank(scores: (number | null)[], dir: Dir): Rank {
  const out: Rank = { best: new Set(), worst: new Set() };
  if (!dir) return out;
  const known = scores.flatMap((s, i) => (s === null ? [] : [{ s, i }]));
  if (new Set(known.map((k) => k.s)).size < 2) return out;
  const hi = Math.max(...known.map((k) => k.s));
  const lo = Math.min(...known.map((k) => k.s));
  for (const { s, i } of known) {
    if (s === (dir === 'high' ? hi : lo)) out.best.add(i);
    if (s === (dir === 'high' ? lo : hi)) out.worst.add(i);
  }
  return out;
}

/** True when the visible cells are not all equal. Unknown ("?") counts as a value of its own. */
export function differs(signatures: string[]): boolean {
  return new Set(signatures).size > 1;
}

/** Min-max to 0..1 across the given values; null stays null. A single distinct value maps to 0.5. */
export function normalize(values: (number | null)[], dir: 'high' | 'low'): (number | null)[] {
  const known = values.filter((v): v is number => v !== null);
  if (!known.length) return values.map(() => null);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  return values.map((v) => {
    if (v === null) return null;
    if (hi === lo) return 0.5;
    const x = (v - lo) / (hi - lo);
    return dir === 'high' ? x : 1 - x;
  });
}
