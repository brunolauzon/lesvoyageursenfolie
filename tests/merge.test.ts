import { describe, expect, it } from 'vitest';
import { mergeFacilities, missingKeys } from '../src/lib/merge';
import type { ProviderResult } from '../src/schema/facilities';

const at = '2026-10-06T12:00:00.000Z';
const result = (fields: ProviderResult['fields']): ProviderResult => ({ fetchedAt: at, fields });

describe('mergeFacilities priority', () => {
  const fetched = {
    official: result({ stars: { value: 5, confidence: 0.8 }, tennis: { value: true, confidence: 0.7 } }),
    osm: result({ stars: { value: 4, confidence: 0.7 }, hasPool: { value: true, confidence: 0.5 } }),
    wikidata: result({ stars: { value: 3, confidence: 0.8 }, openingYear: { value: 2008, confidence: 0.8 } }),
    llm: result({ stars: { value: 2, confidence: 0.6 }, golf: { value: true, confidence: 0.6 } }),
  };

  it('takes each field from the first source that has it', () => {
    const m = mergeFacilities(fetched, {}, null);
    expect(m.stars).toMatchObject({ value: 5, source: 'official' });
    expect(m.hasPool).toMatchObject({ value: true, source: 'osm' });
    expect(m.openingYear?.source).toBe('wikidata');
    expect(m.golf?.source).toBe('llm');
  });
  it('lets a hand-written override win over everything', () => {
    const m = mergeFacilities(fetched, {}, { stars: 4.5 });
    expect(m.stars).toMatchObject({ value: 4.5, source: 'override', confidence: 1, fetchedAt: null });
  });
  it('treats an override of null as "unknown", hiding fetched values', () => {
    const m = mergeFacilities(fetched, {}, { stars: null });
    expect(m.stars).toBeUndefined();
  });
  it('ranks manual values above fetched ones but below overrides', () => {
    expect(mergeFacilities(fetched, { stars: 1 }, null).stars?.source).toBe('manual');
    expect(mergeFacilities(fetched, { stars: 1 }, { stars: 2 }).stars?.source).toBe('override');
  });
  it('skips invalid values and falls through to the next source', () => {
    const bad = { official: result({ stars: { value: 'five', confidence: 0.9 } }), osm: result({ stars: { value: 4, confidence: 0.7 } }) };
    expect(mergeFacilities(bad, {}, null).stars?.source).toBe('osm');
  });
  it('lists what is still missing', () => {
    const missing = missingKeys(mergeFacilities(fetched, {}, null));
    expect(missing).not.toContain('stars');
    expect(missing).toContain('rating');
  });
});
