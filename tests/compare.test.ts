import { describe, expect, it } from 'vitest';
import { differs, normalize, rank } from '../src/lib/compare';
import { computeScores, type Criterion } from '../src/lib/score';
import { parseHash, serializeHash } from '../src/lib/hash-state';

describe('rank', () => {
  it('finds best and worst in both directions', () => {
    expect([...rank([3, 9, 5], 'high').best]).toEqual([1]);
    expect([...rank([3, 9, 5], 'high').worst]).toEqual([0]);
    expect([...rank([3, 9, 5], 'low').best]).toEqual([0]);
  });
  it('highlights ties', () => {
    expect([...rank([9, 9, 1], 'high').best]).toEqual([0, 1]);
  });
  it('highlights nothing when all values are equal, unknown, or the row is neutral', () => {
    expect(rank([4, 4, 4], 'high').best.size).toBe(0);
    expect(rank([null, 4, null], 'high').best.size).toBe(0);
    expect(rank([1, 2], null).best.size).toBe(0);
  });
  it('ignores unknown values', () => {
    const r = rank([null, 2, 8], 'high');
    expect([...r.best, ...r.worst].sort()).toEqual([1, 2]);
  });
});

describe('differs', () => {
  it('detects identical and different rows', () => {
    expect(differs(['a', 'a'])).toBe(false);
    expect(differs(['a', '?'])).toBe(true);
  });
});

describe('normalize', () => {
  it('scales min-max with best = 1', () => {
    expect(normalize([10, 20, 30], 'high')).toEqual([0, 0.5, 1]);
    expect(normalize([10, 20, 30], 'low')).toEqual([1, 0.5, 0]);
  });
  it('keeps nulls and handles a single distinct value', () => {
    expect(normalize([null, 5, 15], 'high')).toEqual([null, 0, 1]);
    expect(normalize([7, 7], 'high')).toEqual([0.5, 0.5]);
    expect(normalize([null, null], 'high')).toEqual([null, null]);
  });
});

describe('computeScores', () => {
  const criteria: Criterion[] = [
    { key: 'weather', label: 'Météo', subs: [{ key: 't', label: 'T', dir: 'high', values: { a: 30, b: 20, c: 25 } }] },
    { key: 'price', label: 'Prix', subs: [{ key: 'p', label: 'P', dir: 'low', values: { a: 100, b: 200, c: null } }] },
  ];

  it('weights criteria and sorts best first', () => {
    const r = computeScores(criteria, ['a', 'b'], { weather: 5, price: 5 });
    expect(r.map((s) => s.slug)).toEqual(['a', 'b']);
    expect(r[0]!.total).toBe(100);
    expect(r[1]!.total).toBe(0);
  });
  it('redistributes the weight of a missing criterion and reports it', () => {
    const r = computeScores(criteria, ['a', 'b', 'c'], { weather: 5, price: 5 });
    const c = r.find((s) => s.slug === 'c')!;
    expect(c.missing).toEqual(['price']);
    expect(c.total).toBe(50); // weather only: (25-20)/(30-20) = 0.5, full weight
    expect(c.points.price).toBe(0);
  });
  it('ignores zero-weight criteria, even when data is missing', () => {
    const c = computeScores(criteria, ['a', 'c'], { weather: 5, price: 0 }).find((s) => s.slug === 'c')!;
    expect(c.missing).toEqual([]);
  });
  it('gives null when nothing is weighted', () => {
    expect(computeScores(criteria, ['a', 'b'], { weather: 0, price: 0 })[0]!.total).toBeNull();
  });
});

describe('hash state', () => {
  const slugs = ['a', 'b', 'c'];
  const defaults = { weather: 8, price: 6 };
  it('round-trips and stays empty for defaults', () => {
    const base = parseHash('', slugs, defaults);
    expect(serializeHash(base, slugs, defaults)).toBe('');
    const s = { ...base, order: ['c', 'a'], pin: 'a', diff: true, collapsed: ['food'], weights: { weather: 2, price: 6 } };
    const back = parseHash(serializeHash(s, slugs, defaults), slugs, defaults);
    expect(back).toEqual(s);
  });
  it('drops unknown slugs, weights and an invalid pin; clamps weights', () => {
    const s = parseHash('#r=a,zzz,b&pin=c&w=weather:99,nope:3', slugs, defaults);
    expect(s.order).toEqual(['a', 'b']);
    expect(s.pin).toBeNull();
    expect(s.weights).toEqual({ weather: 10, price: 6 });
  });
});
