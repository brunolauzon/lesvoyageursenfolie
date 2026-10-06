import { describe, expect, it } from 'vitest';
import { nameSimilarity, sameHost, scoreCandidate } from '../scripts/lib/match';

describe('nameSimilarity', () => {
  it('ignores accents, case and filler words', () => {
    expect(nameSimilarity('Hotel Riu Palace Punta Cana', 'RIU Palace Punta Cana Resort')).toBe(1);
    expect(nameSimilarity('Paradisus Cancun', 'Paradisus Cancún')).toBe(1);
  });
  it('scores a different hotel low', () => {
    expect(nameSimilarity('Hotel Riu Palace Punta Cana', 'Riu Palace Macao')).toBeLessThan(0.6);
  });
  it('is 0 when nothing is shared', () => {
    expect(nameSimilarity('Iberostar Varadero', 'Sandals Negril')).toBe(0);
  });
});

describe('scoreCandidate', () => {
  const input = { name: 'Paradisus Cancun', url: 'https://www.melia.com/paradisus' };
  it('caps non-lodging places at 0.75', () => {
    expect(scoreCandidate({ name: 'Paradisus Cancun', lodging: false, website: null }, input)).toBe(0.75);
  });
  it('rejects a lodging with only half the name', () => {
    expect(scoreCandidate({ name: 'Paradisus', lodging: true, website: null }, { name: 'Paradisus La Esmeralda Playa' })).toBeLessThan(0.6);
  });
  it('adds a bonus when the official website matches', () => {
    const c = { name: 'Paradisus', lodging: true, website: 'http://melia.com/' };
    expect(scoreCandidate(c, input)).toBeGreaterThan(scoreCandidate({ ...c, website: null }, input));
  });
});

describe('sameHost', () => {
  it('ignores www and path', () => {
    expect(sameHost('https://www.riu.com/a', 'http://riu.com/b')).toBe(true);
    expect(sameHost('https://riu.com', 'https://melia.com')).toBe(false);
    expect(sameHost('not a url', 'https://melia.com')).toBe(false);
  });
});
