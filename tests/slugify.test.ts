import { describe, expect, it } from 'vitest';
import { slugify } from '../src/lib/slugify';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Iberostar Selection Varadero')).toBe('iberostar-selection-varadero');
  });
  it('strips accents', () => {
    expect(slugify('Hôtel Sélection Cancún')).toBe('hotel-selection-cancun');
  });
  it('collapses punctuation and trims', () => {
    expect(slugify("  Riu Palace -- Punta Cana! ")).toBe('riu-palace-punta-cana');
  });
  it('expands ampersand', () => {
    expect(slugify('Sun & Sand')).toBe('sun-and-sand');
  });
});
