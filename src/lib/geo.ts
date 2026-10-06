// Build-time map geometry: one projection shared by the hero route map and every locator minimap,
// so the land layers are drawn once per page and reused with <use>.
import { geoContains, geoGraticule10, geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import world from 'world-atlas/countries-50m.json';
import { AIRPORTS, ORIGIN } from '../../scripts/data/airports.js';
import { cityOf, countryOf, type Resort } from './resorts';
import { countryInfo, flagOf } from './countries';
import { duration } from './format';

export const MAP = { W: 1000, H: 640 } as const;
const PAD = { l: 110, r: 110, t: 120, b: 110 }; // fit padding inside the viewBox, room for labels
const MARGIN = 140; // land is drawn this far outside the viewBox so locator crops never show bare sea

type LonLat = [number, number];
type Country = Feature<Geometry, { name: string }>;

const countries = feature(world as never, (world as never as { objects: { countries: never } }).objects.countries) as unknown as FeatureCollection<
  Geometry,
  { name: string }
>;

export interface Pin {
  id: string;
  nom: string;
  city: string | null;
  x: number;
  y: number;
}

export interface Cluster {
  key: string;
  code: string | null;
  airportCity: string | null;
  country: string | null;
  flag: string;
  resorts: Resort[];
  pins: Pin[];
  ax: number;
  ay: number;
  arc: string | null;
  flightMin: number | null;
  transferMin: number | null;
  direct: boolean | null;
  labelAnchor: 'start' | 'end';
  label: string;
  sublabel: string;
}

export interface Scene {
  land: string;
  /** One outline per country that has a resort, so each can wear its own hue. */
  highlights: { country: string; id: string; path: string }[];
  graticule: string;
  origin: { x: number; y: number; visible: boolean };
  clusters: Cluster[];
  seas: { label: string; x: number; y: number }[];
  pinOf: (id: string) => { pin: Pin; cluster: Cluster } | null;
}

function airportOf(r: Resort) {
  const code = r.logistiqueTransport?.aeroportArrivee?.match(/^[A-Z]{3}/)?.[0];
  return code ? AIRPORTS.find((a) => a.code === code) ?? null : null;
}

const SEAS: [string, LonLat][] = [
  ['Mer des Caraïbes', [-76, 14.3]],
  ['Golfe du Mexique', [-90, 25]],
  ['Océan Atlantique', [-58, 31]],
];

let cached: { key: string; scene: Scene } | null = null;

export function buildScene(resorts: Resort[]): Scene {
  const located = resorts.filter((r) => r.coordonnees);
  const key = located.map((r) => `${r.id}:${r.coordonnees!.lat},${r.coordonnees!.lon}:${airportOf(r)?.code}`).join('|');
  if (cached?.key === key) return cached.scene;

  const origin: LonLat = [ORIGIN.lon, ORIGIN.lat];
  const resortPoints = located.map((r): LonLat => [r.coordonnees!.lon, r.coordonnees!.lat]);
  const airportPoints = located.flatMap((r) => {
    const a = airportOf(r);
    return a ? [[a.lon, a.lat] as LonLat] : [];
  });
  // Frame the destinations (Montréal is far to the north, so routes enter from the top edge).
  // With no resorts yet, frame the Caribbean; with a tight cluster, keep at least a 16 x 8 degree window.
  const dest: LonLat[] = [...resortPoints, ...airportPoints];
  if (dest.length === 0) dest.push([-87, 21], [-68, 18.6], [-70, 12.5]);
  const lons = dest.map((p) => p[0]);
  const lats = dest.map((p) => p[1]);
  const cx = (Math.min(...lons) + Math.max(...lons)) / 2;
  const cy0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const halfW = Math.max((Math.max(...lons) - Math.min(...lons)) / 2, 8);
  const halfH = Math.max((Math.max(...lats) - Math.min(...lats)) / 2, 4);
  const fitPoints: LonLat[] = [[cx - halfW, cy0 - halfH], [cx + halfW, cy0 + halfH], ...dest];

  const projection = geoMercator().fitExtent(
    [
      [PAD.l, PAD.t],
      [MAP.W - PAD.r, MAP.H - PAD.b],
    ],
    { type: 'MultiPoint', coordinates: fitPoints },
  );
  projection.clipExtent([
    [-MARGIN, -MARGIN],
    [MAP.W + MARGIN, MAP.H + MARGIN],
  ]);
  const path = geoPath(projection).digits(1);

  // Countries with a resort get an outline: found by name, or because they contain a resort or airport point.
  const featuresByCountry = new Map<string, Set<Country>>();
  for (const r of located) {
    const country = countryOf(r);
    if (!country) continue;
    const mine = featuresByCountry.get(country) ?? new Set<Country>();
    const en = countryInfo(country)?.en;
    const points: LonLat[] = [[r.coordonnees!.lon, r.coordonnees!.lat]];
    const airport = airportOf(r);
    if (airport) points.push([airport.lon, airport.lat]);
    for (const f of countries.features as Country[]) if (f.properties.name === en || points.some((p) => geoContains(f, p))) mine.add(f);
    featuresByCountry.set(country, mine);
  }

  const xy = (p: LonLat) => projection(p);

  // One cluster per arrival airport (two resorts in Negril share MBJ, so one route and one label).
  const groups = new Map<string, Resort[]>();
  for (const r of located) {
    const k = airportOf(r)?.code ?? r.id;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const [ox, oy] = xy(origin) ?? [0, 0];
  const clusters: Cluster[] = [...groups.entries()].map(([k, group]) => {
    const first = group[0];
    const airport = airportOf(first);
    const [ax, ay] = xy(airport ? [airport.lon, airport.lat] : [first.coordonnees!.lon, first.coordonnees!.lat]) ?? [0, 0];

    // Quadratic arc bulging to the east, like an airline route map.
    const dx = ax - ox;
    const dy = ay - oy;
    const len = Math.hypot(dx, dy);
    let arc: string | null = null;
    if (len > 20) {
      const sign = -dy >= 0 ? 1 : -1;
      const cx = (ox + ax) / 2 + sign * (-dy / len) * len * 0.18;
      const cy = (oy + ay) / 2 + sign * (dx / len) * len * 0.18;
      arc = `M${ox.toFixed(1)} ${oy.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ax.toFixed(1)} ${ay.toFixed(1)}`;
    }

    const t = first.logistiqueTransport;
    const label = `${airport?.ville ?? cityOf(first) ?? first.nom}${airport ? ` (${airport.code})` : ''}`;
    const sublabel = `${group.length} resort${group.length > 1 ? 's' : ''}${t?.dureeVolMinutes ? `, ${duration(t.dureeVolMinutes)} d’avion` : ''}`;
    // Put the label on the left when it would run off the right edge (rough text width estimate).
    const textW = Math.max(label.length + 3, sublabel.length) * 9;
    return {
      key: k,
      code: airport?.code ?? null,
      airportCity: airport?.ville ?? cityOf(first),
      country: countryOf(first),
      flag: flagOf(countryOf(first)),
      resorts: group,
      pins: group.map((r) => {
        const [x, y] = xy([r.coordonnees!.lon, r.coordonnees!.lat]) ?? [ax, ay];
        return { id: r.id, nom: r.nom, city: cityOf(r), x, y };
      }),
      ax,
      ay,
      arc,
      flightMin: t?.dureeVolMinutes ?? null,
      transferMin: t?.tempsTransfertMinutes ?? null,
      direct: t?.volDirect ?? null,
      labelAnchor: ax + 16 + textW > MAP.W - 12 ? 'end' : 'start',
      label,
      sublabel,
    };
  });

  const seas = SEAS.flatMap(([label, p]) => {
    const pt = xy(p);
    return pt && pt[0] > 60 && pt[0] < MAP.W - 60 && pt[1] > 40 && pt[1] < MAP.H - 40 ? [{ label, x: pt[0], y: pt[1] }] : [];
  });

  const scene: Scene = {
    land: path(countries) ?? '',
    highlights: [...featuresByCountry].map(([country, feats], i) => ({
      country,
      id: `map-hi-${i}`,
      path: path({ type: 'FeatureCollection', features: [...feats] }) ?? '',
    })),
    graticule: path(geoGraticule10()) ?? '',
    origin: { x: ox, y: oy, visible: ox > 30 && ox < MAP.W - 30 && oy > 30 && oy < MAP.H - 30 },
    clusters,
    seas,
    pinOf: (id) => {
      for (const cluster of clusters) {
        const pin = cluster.pins.find((p) => p.id === id);
        if (pin) return { pin, cluster };
      }
      return null;
    },
  };
  cached = { key, scene };
  return scene;
}
