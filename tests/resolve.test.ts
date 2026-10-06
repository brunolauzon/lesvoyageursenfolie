import { describe, expect, it } from 'vitest';
import { ResolveError, buildMeta, hashInput, type Scored } from '../scripts/providers/resolve';
import { TTL_DAYS, isFresh } from '../scripts/lib/ttl';

const entry = { name: 'Paradisus Cancun', slug: 'paradisus-cancun' };
const now = '2026-10-06T12:00:00.000Z';
const base = { address: null, country: null, website: null, googlePlaceId: null, wikidataId: null, lodging: true };
const cand = (o: Partial<Scored>): Scored => ({ provider: 'nominatim', name: 'Paradisus Cancun', lat: 21.1, lon: -86.75, confidence: 0.9, ...base, ...o });

describe('buildMeta', () => {
  it('fills missing fields from other providers near the winner', () => {
    const meta = buildMeta(entry, [
      cand({ address: 'Blvd Kukulcan' }),
      cand({ provider: 'wikidata', wikidataId: 'Q42', website: 'https://x.test', lat: 21.101, confidence: 0.9 }),
    ], now);
    expect(meta.provider).toBe('nominatim');
    expect(meta.resolved).toMatchObject({ address: 'Blvd Kukulcan', wikidataId: 'Q42', website: 'https://x.test', lat: 21.1 });
    expect(meta.fields.wikidataId?.source).toBe('wikidata');
  });
  it('does not merge a same-named place far away; lists it as alternative', () => {
    const meta = buildMeta(entry, [cand({}), cand({ provider: 'wikidata', wikidataId: 'Q9', lat: 10, lon: 10, confidence: 0.8 })], now);
    expect(meta.resolved.wikidataId).toBeNull();
    expect(meta.alternatives).toHaveLength(1);
  });
  it('prefers open-source coordinates over Google when they agree', () => {
    const meta = buildMeta(entry, [
      cand({ provider: 'google', googlePlaceId: 'g1', lat: 21.1002, confidence: 0.95 }),
      cand({ lat: 21.1 }),
    ], now);
    expect(meta.resolved.googlePlaceId).toBe('g1');
    expect(meta.resolved.lat).toBe(21.1);
    expect(meta.fields.lat?.source).toBe('nominatim');
  });
  it('never stores Google text content; keeps the place id and the input name', () => {
    const meta = buildMeta(entry, [cand({ provider: 'google', name: 'Paradisus Cancun All Inclusive', googlePlaceId: 'g1', address: 'G addr', website: 'https://g.test', confidence: 0.95 })], now);
    expect(meta.resolved).toMatchObject({ name: 'Paradisus Cancun', googlePlaceId: 'g1', address: null, website: null });
  });
  it('throws low-confidence with the fix hint', () => {
    expect(() => buildMeta(entry, [cand({ confidence: 0.4 })], now)).toThrow(/location:/);
  });
  it('reports a network failure distinctly from no match', () => {
    expect.assertions(2);
    try { buildMeta(entry, [], now, ['nominatim: timeout']); } catch (e) { expect((e as ResolveError).kind).toBe('network'); }
    try { buildMeta(entry, [], now); } catch (e) { expect((e as ResolveError).kind).toBe('no-match'); }
  });
});

describe('hashInput / isFresh', () => {
  it('changes when a hint changes', () => {
    expect(hashInput({ name: 'A' })).not.toBe(hashInput({ name: 'A', location: 'Cuba' }));
  });
  it('respects the ttl', () => {
    const t = Date.parse(now);
    expect(isFresh(now, TTL_DAYS.travel, t + 13 * 86_400_000)).toBe(true);
    expect(isFresh(now, TTL_DAYS.travel, t + 15 * 86_400_000)).toBe(false);
    expect(isFresh('garbage', 1, t)).toBe(false);
  });
});
