import { VARS, type DailyStats, type RawYear, type WeatherSummary, type WeatherVar } from '../schema/weather';
import { mean, nums, percentile, round } from './stats';

const RAIN_MM = 1;
const SUNNY_HOURS = 6;

type Series = Record<WeatherVar, (number | null)[]>;

/** API variable names -> our short keys. Sunshine goes from seconds to hours. */
export function toSeries(raw: RawYear): Series {
  const col = (name: string) => raw[name] ?? raw.dates.map(() => null);
  return {
    tmax: col('temperature_2m_max'),
    tmin: col('temperature_2m_min'),
    precip: col('precipitation_sum'),
    sunshine_h: col('sunshine_duration').map((s) => (s === null ? null : s / 3600)),
    wind: col('wind_speed_10m_max'),
    humidity: col('relative_humidity_2m_mean'),
    uv: col('uv_index_max'),
    cloud: col('cloud_cover_mean'),
    sst: col('sea_surface_temperature'),
  };
}

const stat = (xs: number[]) => ({
  mean: round(mean(xs)),
  min: xs.length ? Math.min(...xs) : null,
  max: xs.length ? Math.max(...xs) : null,
  p10: round(percentile(xs, 0.1)),
  p90: round(percentile(xs, 0.9)),
  n: xs.length,
});

const share = (xs: number[], pred: (x: number) => boolean) =>
  xs.length ? round(xs.filter(pred).length / xs.length, 3) : null;

/** Per-calendar-day statistics across years, plus a summary of the stay days. */
export function aggregate(
  raw: Record<string, RawYear>,
  days: string[],
  tripDays: string[],
): { daily: DailyStats[]; summary: WeatherSummary } {
  const years = Object.values(raw).map((y) => ({ dates: y.dates, s: toSeries(y) }));

  /** All values of `v` for calendar day `md`, one per year. */
  const valuesFor = (md: string, v: WeatherVar) =>
    nums(years.map((y) => y.s[v][y.dates.findIndex((d) => d.slice(5) === md)] ?? null));

  const daily: DailyStats[] = days.map((md) => {
    const stats = Object.fromEntries(VARS.map((v) => [v, stat(valuesFor(md, v))]));
    return {
      md,
      stats,
      rainyShare: share(valuesFor(md, 'precip'), (x) => x > RAIN_MM),
      sunnyShare: share(valuesFor(md, 'sunshine_h'), (x) => x >= SUNNY_HOURS),
    };
  });

  const pooled = (v: WeatherVar) => tripDays.flatMap((md) => valuesFor(md, v));
  const sunshine = pooled('sunshine_h');
  const rain = pooled('precip');
  const seaYears = years.filter((y) => nums(y.s.sst).length > 0).length;

  return {
    daily,
    summary: {
      yearsUsed: years.length,
      avgHigh: round(mean(pooled('tmax'))),
      avgLow: round(mean(pooled('tmin'))),
      rainyDayPct: rain.length ? round((rain.filter((x) => x > RAIN_MM).length / rain.length) * 100, 0) : null,
      precipMmPerDay: round(mean(rain)),
      sunshineHoursPerDay: round(mean(sunshine)),
      sunnyDayPct: sunshine.length ? round((sunshine.filter((x) => x >= SUNNY_HOURS).length / sunshine.length) * 100, 0) : null,
      windKmh: round(mean(pooled('wind')), 0),
      uvIndex: round(mean(pooled('uv'))),
      seaTemp: seaYears ? round(mean(pooled('sst'))) : null,
      humidityPct: round(mean(pooled('humidity')), 0),
      cloudPct: round(mean(pooled('cloud')), 0),
    },
  };
}
