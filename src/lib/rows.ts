/** Turns resort data into the rows of the comparison table. Pure: no I/O, so it is easy to test. */
import { FIELDS, GROUPS, type FieldDef } from '../schema/facility-fields';
import type { FieldValue } from '../schema/facilities';
import type { Trip } from '../schema/trip';
import { loadCountries, findCountry, type Country } from './countries';
import type { Dir } from './compare';
import { nights } from './dates';
import { formatDate, formatMoney, formatNumber, formatPercent, formatUnit } from './format';
import { t } from './i18n';
import type { ResortView } from './resorts';
import { doorToDoor, formatDuration } from './travel';

export interface Cell {
  text: string;
  /** Comparable number, or null when this value can't be ranked */
  score: number | null;
  /** Equality signature for "differences only" */
  sig: string;
  missing: boolean;
  badge: 'override' | 'verify' | 'estimate' | null;
  /** Tooltip: source and date */
  title: string;
}

export interface Row {
  id: string;
  label: string;
  dir: Dir;
  cells: Cell[];
}

export interface Section {
  key: string;
  label: string;
  rows: Row[];
}

const MISSING: Cell = { text: '?', score: null, sig: '?', missing: true, badge: null, title: t('badge.missing') };
const UNIT_SUFFIX: Record<string, string> = { meter: 'm', 'square-meter': 'm²', kilometer: 'km' };

export const VERIFY_BELOW = 0.6;

function describe(f: FieldValue): { badge: Cell['badge']; title: string } {
  const source = t(`sources.${f.source}`);
  const when = f.fetchedAt ? t('badge.updated', { date: formatDate(f.fetchedAt.slice(0, 10)) }) : t('badge.handWritten');
  const badge = f.source === 'override' || f.source === 'manual' ? 'override' : f.confidence <= VERIFY_BELOW ? 'verify' : null;
  return { badge, title: `${t('badge.source', { source })} · ${when}` };
}

function formatFacility(def: FieldDef, value: unknown): { text: string; score: number | null } {
  switch (def.type) {
    case 'bool': return { text: value ? t('yes') : t('no'), score: value ? 1 : 0 };
    case 'number': {
      const n = value as number;
      const suffix = def.unit ? ` ${UNIT_SUFFIX[def.unit] ?? ''}` : '';
      return { text: `${formatNumber(n, n % 1 ? 1 : 0)}${suffix}`, score: n };
    }
    case 'enum': return { text: t(`enums.${def.key}.${value as string}`), score: def.options!.indexOf(value as string) };
    case 'list': return { text: (value as string[]).join(', '), score: null };
    case 'text': return { text: String(value), score: null };
  }
}

export function facilityCell(def: FieldDef, f: FieldValue | undefined): Cell {
  if (!f) return MISSING;
  const { text, score } = formatFacility(def, f.value);
  return { text, score, sig: text, missing: false, ...describe(f) };
}

function plain(text: string | null, score: number | null, title: string, badge: Cell['badge'] = null): Cell {
  return text === null ? { ...MISSING } : { text, score, sig: text, missing: false, badge, title };
}

const num = (n: number | null | undefined, f: (n: number) => string, score = n ?? null) => (n == null ? null : { text: f(n), score });

export function buildSections(views: ResortView[], trip: Trip): Section[] {
  const countries = safeCountries();
  const row = (id: string, dir: Dir, cells: Cell[]): Row => ({ id, label: t(`fields.${id}`), dir, cells });
  const n = nights(trip);

  const facilityRows = (group: string): Row[] =>
    FIELDS.filter((d) => d.group === group).map((def) =>
      row(def.key, def.better ?? null, views.map((v) => facilityCell(def, v.facts.fields[def.key]))),
    );

  // Price: manual, per person for the whole stay (see README).
  const price = (v: ResortView) => v.entry.price_cad ?? null;
  const sunny = (v: ResortView) => (v.weather?.summary.sunnyDayPct ?? null);
  const priceRows: Row[] = [
    row('price', 'low', views.map((v) => plain(price(v) === null ? null : formatMoney(price(v)!, trip.currency), price(v), t('sources.manual'), 'override'))),
    row('pricePerNight', 'low', views.map((v) => plain(price(v) === null ? null : formatMoney(price(v)! / n, trip.currency), price(v) === null ? null : price(v)! / n, t('sources.computed')))),
    row('priceCostPerSunnyDay', 'low', views.map((v) => {
      const s = sunny(v);
      const p = price(v);
      if (p === null || s === null || s === 0) return { ...MISSING };
      const perDay = p / (n * (s / 100));
      return plain(formatMoney(perDay, trip.currency), perDay, t('sources.computed'));
    })),
  ];

  const w = (id: string, dir: Dir, pick: (v: ResortView) => number | null | undefined, fmt: (n: number) => string): Row =>
    row(id, dir, views.map((v) => {
      const r = num(pick(v), fmt);
      return r ? plain(r.text, r.score, t('sources.weather')) : { ...MISSING };
    }));
  const weatherRows = [
    w('w_avgHigh', 'high', (v) => v.weather?.summary.avgHigh, (n) => formatUnit(n, 'celsius')),
    w('w_avgLow', 'high', (v) => v.weather?.summary.avgLow, (n) => formatUnit(n, 'celsius')),
    w('w_rainyDayPct', 'low', (v) => v.weather?.summary.rainyDayPct, (n) => formatPercent(n)),
    w('w_sunshine', 'high', (v) => v.weather?.summary.sunshineHoursPerDay, (n) => formatUnit(n, 'hour')),
    w('w_sunnyDayPct', 'high', (v) => v.weather?.summary.sunnyDayPct, (n) => formatPercent(n)),
    w('w_sea', 'high', (v) => v.weather?.summary.seaTemp, (n) => formatUnit(n, 'celsius')),
    w('w_wind', 'low', (v) => v.weather?.summary.windKmh, (n) => formatUnit(n, 'kilometer-per-hour', 0)),
    w('w_humidity', 'low', (v) => v.weather?.summary.humidityPct, (n) => formatPercent(n)),
    w('w_uv', null, (v) => v.weather?.summary.uvIndex, (n) => formatNumber(n, 1)),
  ];

  const tr = (id: string, dir: Dir, pick: (v: ResortView, d: ReturnType<typeof doorToDoor>) => { text: string; score: number | null; estimated?: boolean } | null): Row =>
    row(id, dir, views.map((v) => {
      if (!v.travel) return { ...MISSING };
      const r = pick(v, doorToDoor(v.travel, trip.travel));
      return r ? plain(r.text, r.score, t('sources.travel'), r.estimated ? 'estimate' : null) : { ...MISSING };
    }));
  const travelRows = [
    tr('t_total', 'low', (v, d) => ({ text: formatDuration(d.total), score: d.total, estimated: v.travel!.flight.estimated || v.travel!.transfer.estimated })),
    tr('t_flight', 'low', (v) => ({ text: formatDuration(v.travel!.flight.minutes), score: v.travel!.flight.minutes, estimated: v.travel!.flight.estimated })),
    tr('t_stops', 'low', (v) => ({ text: v.travel!.flight.stops === 0 ? t('travel.stops0') : t('travel.stops1'), score: v.travel!.flight.stops })),
    tr('t_transfer', 'low', (v, d) => ({ text: formatDuration(d.transfer), score: d.transfer, estimated: v.travel!.transfer.estimated })),
    tr('t_transferKm', 'low', (v) => ({ text: formatUnit(v.travel!.transfer.km, 'kilometer'), score: v.travel!.transfer.km })),
    tr('t_tz', null, (v) => {
      const h = v.travel!.timezone.diffHours;
      return { text: h === 0 ? t('travel.sameTime') : `${h > 0 ? '+' : '−'}${formatNumber(Math.abs(h), 1)} h`, score: null };
    }),
    tr('t_airport', null, (v) => ({ text: v.travel!.airport.iata, score: null })),
    tr('t_flightPrice', 'low', (v) => (v.travel!.flight.priceCad == null ? null : { text: formatMoney(v.travel!.flight.priceCad, trip.currency), score: v.travel!.flight.priceCad })),
  ];

  const countryOf = (v: ResortView): Country | null => findCountry(countries, v.travel?.airport.country);
  const cr = (id: string, pick: (c: Country) => string): Row =>
    row(id, null, views.map((v) => {
      const c = countryOf(v);
      return c ? plain(pick(c), null, t('sources.computed')) : { ...MISSING };
    }));
  const destinationRows = [
    cr('d_currency', (c) => c.currency),
    cr('d_plug', (c) => c.plugs.join(', ')),
    cr('d_voltage', (c) => c.voltage),
    cr('d_language', (c) => c.language),
  ];

  return [
    { key: 'overview', label: t('groups.overview'), rows: [...priceRows, ...facilityRows('overview')] },
    { key: 'weather', label: t('groups.weather'), rows: weatherRows },
    { key: 'travel', label: t('groups.travel'), rows: travelRows },
    { key: 'food', label: t('groups.food'), rows: facilityRows('food') },
    { key: 'beachPools', label: t('groups.beachPools'), rows: [...facilityRows('beach'), ...facilityRows('pools')] },
    { key: 'rooms', label: t('groups.rooms'), rows: facilityRows('rooms') },
    { key: 'activities', label: t('groups.activities'), rows: facilityRows('activities') },
    { key: 'practical', label: t('groups.practical'), rows: [...facilityRows('practical'), ...destinationRows] },
  ];
}

function safeCountries() {
  try {
    return loadCountries();
  } catch {
    return {};
  }
}

export { GROUPS };
