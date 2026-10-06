import { describe, expect, it } from 'vitest';
import { mapAmenity } from '../scripts/lib/amenities';
import { parseCsv } from '../scripts/lib/csv';
import { jsonLdNodes, metaContent, visibleText } from '../scripts/lib/html';
import { isAllowed } from '../scripts/lib/robots';
import { factsFromJsonLd } from '../scripts/providers/facilities/official';
import { acceptFacts, buildRequest, MAX_CONFIDENCE } from '../scripts/providers/facilities/llm';
import { buildQuery, factsFromElements } from '../scripts/providers/facilities/osm';
import { loadAirports } from '../src/lib/reference';

describe('robots.txt', () => {
  const txt = 'User-agent: *\nDisallow: /private\nAllow: /private/public\n\nUser-agent: lesvoyageursenfolie\nDisallow: /nope';
  it('uses the most specific group and longest match', () => {
    expect(isAllowed(txt, '/private/x', 'other')).toBe(false);
    expect(isAllowed(txt, '/private/public/x', 'other')).toBe(true);
    expect(isAllowed(txt, '/nope/x', 'lesvoyageursenfolie')).toBe(false);
    expect(isAllowed(txt, '/private/x', 'lesvoyageursenfolie')).toBe(true);
  });
  it('allows everything without rules', () => expect(isAllowed('', '/a', 'x')).toBe(true));
});

describe('amenities', () => {
  it('maps labels to facts', () => {
    expect(mapAmenity('Swim-up bar')).toEqual([{ key: 'swimUpBar', value: true }]);
    expect(mapAmenity('Free WiFi')).toEqual([{ key: 'wifiFree', value: true }]);
    expect(mapAmenity('Tout inclus')).toEqual([{ key: 'allInclusive', value: 'yes' }]);
    expect(mapAmenity('Karaoke')).toEqual([]);
  });
  it('flips booleans when the feature is declared absent', () => {
    expect(mapAmenity('Tennis court', false)).toEqual([{ key: 'tennis', value: false }]);
  });
});

describe('HTML helpers', () => {
  const html = `<html><head><meta property="og:image" content="/a.jpg"><script type="application/ld+json">{"@graph":[{"@type":"Hotel","name":"X"}]}</script><script type="application/ld+json">{bad</script></head><body><p>Hello&nbsp;<b>world</b></p><script>var x=1</script></body></html>`;
  it('extracts JSON-LD, tolerating broken blocks', () => expect(jsonLdNodes(html).some((n) => n['@type'] === 'Hotel')).toBe(true));
  it('reads meta tags', () => expect(metaContent(html, 'og:image')).toBe('/a.jpg'));
  it('extracts visible text only', () => expect(visibleText(html)).toBe('Hello world'));
});

describe('official site JSON-LD', () => {
  it('maps schema.org lodging facts and keeps self-reported ratings at low confidence', () => {
    const f = factsFromJsonLd({
      '@type': 'Hotel', starRating: { ratingValue: '5' }, numberOfRooms: { value: 400 }, checkinTime: '15:00', petsAllowed: 'false',
      aggregateRating: { ratingValue: 9, bestRating: 10, reviewCount: 120 },
      amenityFeature: [{ name: 'Swim-up bar', value: true }, { name: 'Golf', value: false }],
    }, 'https://h.test');
    expect(f.stars?.value).toBe(5);
    expect(f.roomCount?.value).toBe(400);
    expect(f.pets?.value).toBe(false);
    expect(f.swimUpBar?.value).toBe(true);
    expect(f.golf?.value).toBe(false);
    expect(f.rating).toMatchObject({ value: 4.5, confidence: 0.4 });
  });
  it('drops invalid values', () => expect(factsFromJsonLd({ starRating: { ratingValue: 'x' } }, 'u').stars).toBeUndefined());
});

type Els = Parameters<typeof factsFromElements>[0];

describe('OSM facts', () => {
  const at = { lat: 21, lon: -86 };
  it('reads hotel tags only when the name matches', () => {
    const els: Els = [{ type: 'way', id: 1, center: at, tags: { tourism: 'hotel', name: 'Other Place', stars: '3' } }];
    expect(factsFromElements(els, at, 'Paradisus Cancun').stars).toBeUndefined();
    els[0]!.tags!.name = 'Paradisus Cancún';
    expect(factsFromElements(els, at, 'Paradisus Cancun').stars?.value).toBe(3);
  });
  it('derives beach, pools and nearest town', () => {
    const els: Els = [
      { type: 'way', id: 2, geometry: [{ lat: 21.0005, lon: -86 }, { lat: 21.001, lon: -86 }], tags: { natural: 'beach', surface: 'sand' } },
      { type: 'way', id: 3, center: at, tags: { leisure: 'swimming_pool' } },
      { type: 'way', id: 4, center: at, tags: { leisure: 'swimming_pool', access: 'private' } },
      { type: 'node', id: 5, lat: 21.05, lon: -86, tags: { place: 'town' } },
    ];
    const f = factsFromElements(els, at, 'X');
    expect(f.beachfront?.value).toBe(true);
    expect(f.beachType?.value).toBe('sand');
    expect(f.poolCount?.value).toBe(1);
    expect(f.nearestTownKm?.value).toBeCloseTo(5.6, 0);
  });
  it('builds a bounded query', () => expect(buildQuery(at)).toContain('around:2000,21,-86'));
});

describe('LLM extraction', () => {
  it('requires a tool call and lists only the missing fields', () => {
    const req = buildRequest('text', ['golf', 'stars']);
    expect(req.tool_choice).toEqual({ type: 'tool', name: 'record_facts' });
    expect(Object.keys(req.tools[0]!.input_schema.properties)).toEqual(['golf', 'stars']);
    expect(req.system).toMatch(/null/);
  });
  it('accepts valid values at capped confidence and drops nulls, invalid values and unrequested keys', () => {
    const out = acceptFacts({ golf: true, stars: 9.5, tennis: true, allInclusive: null, pets: 'maybe' }, ['golf', 'stars', 'allInclusive', 'pets'], 'https://h.test');
    expect(Object.keys(out)).toEqual(['golf', 'stars']);
    expect(out.golf!.confidence).toBeLessThanOrEqual(MAX_CONFIDENCE);
  });
});

describe('reference data', () => {
  it('parses quoted CSV', () => expect(parseCsv('a,"b,c","d ""e"""\n1,2,3\n')).toEqual([['a', 'b,c', 'd "e"'], ['1', '2', '3']]));
  it('loads the airport table', () => {
    const airports = loadAirports();
    expect(airports.find((a) => a.iata === 'YUL')?.country).toBe('CA');
    expect(airports.length).toBeGreaterThan(1000);
  });
});
