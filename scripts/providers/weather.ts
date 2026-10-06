/** Historical weather for the stay window, from Open-Meteo (CC BY 4.0). */
import { z } from 'zod';
import { forecastWanted, historyYears, stayDays, windowDates } from '../../src/lib/dates';
import { aggregate } from '../../src/lib/weather-aggregate';
import { WeatherSchema, type RawYear, type Weather } from '../../src/schema/weather';
import { httpJson } from '../lib/http';
import type { CacheProvider, ProviderCtx } from '../lib/provider';
import { TTL_DAYS } from '../lib/ttl';

const TTL_MS = 30 * 86_400_000;
const MIN_YEARS = 3;
/** Open-Meteo's historical forecast archive (the only source of UV) starts around here. */
const UV_FROM_YEAR = 2022;

const ARCHIVE_VARS = [
  'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'rain_sum', 'sunshine_duration',
  'wind_speed_10m_max', 'relative_humidity_2m_mean', 'uv_index_max', 'cloud_cover_mean',
];

const DailyResponse = z.object({
  timezone: z.string(),
  daily: z.object({ time: z.array(z.string()) }).catchall(z.array(z.number().nullable())),
});
const MarineResponse = z.object({
  hourly: z.object({ time: z.array(z.string()), sea_surface_temperature: z.array(z.number().nullable()) }),
});

const query = (o: Record<string, string>) => new URLSearchParams(o).toString();
const yearRange = (y: number, w: { start: string; end: string }) => ({
  start: `${y}-${w.start.slice(5)}`,
  end: `${y + Number(w.end.slice(0, 4)) - Number(w.start.slice(0, 4))}-${w.end.slice(5)}`,
});

function dailyMeanOfHourly(dates: string[], time: string[], values: (number | null)[]): (number | null)[] {
  const sums = new Map<string, { s: number; n: number }>();
  time.forEach((t, i) => {
    const v = values[i];
    if (v === null || v === undefined) return;
    const acc = sums.get(t.slice(0, 10)) ?? { s: 0, n: 0 };
    acc.s += v;
    acc.n += 1;
    sums.set(t.slice(0, 10), acc);
  });
  return dates.map((d) => {
    const a = sums.get(d);
    return a ? Math.round((a.s / a.n) * 10) / 10 : null;
  });
}

async function fetchYear(lat: number, lon: number, year: number, w: { start: string; end: string }) {
  const { start, end } = yearRange(year, w);
  const base = { latitude: String(lat), longitude: String(lon), start_date: start, end_date: end, timezone: 'auto' };

  const archive = DailyResponse.parse(
    await httpJson(`https://archive-api.open-meteo.com/v1/archive?${query({ ...base, daily: ARCHIVE_VARS.join(',') })}`, { ttlMs: TTL_MS }),
  );
  const dates = archive.daily.time;
  const raw = { dates } as RawYear;
  for (const v of ARCHIVE_VARS) raw[v] = archive.daily[v] ?? dates.map(() => null);

  // ERA5 has no UV: borrow it from the historical forecast archive where it exists.
  if (year >= UV_FROM_YEAR) {
    try {
      const uv = DailyResponse.parse(
        await httpJson(`https://historical-forecast-api.open-meteo.com/v1/forecast?${query({ ...base, daily: 'uv_index_max' })}`, { ttlMs: TTL_MS }),
      );
      raw.uv_index_max = uv.daily.uv_index_max ?? raw.uv_index_max!;
    } catch (err) {
      console.warn(`[weather] UV unavailable for ${year}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Sea surface temperature: nulls for inland points and for years before the marine archive begins.
  try {
    const marine = MarineResponse.parse(
      await httpJson(`https://marine-api.open-meteo.com/v1/marine?${query({ ...base, hourly: 'sea_surface_temperature' })}`, { ttlMs: TTL_MS }),
    );
    raw.sea_surface_temperature = dailyMeanOfHourly(dates, marine.hourly.time, marine.hourly.sea_surface_temperature);
  } catch {
    raw.sea_surface_temperature = dates.map(() => null);
  }
  return { raw, timezone: archive.timezone };
}

async function fetchForecast(lat: number, lon: number, ctx: ProviderCtx) {
  const last = stayDays(ctx.trip).at(-1)!;
  const end = `${ctx.trip.stay.end.slice(0, 4)}-${last}`;
  const res = DailyResponse.parse(
    await httpJson(
      `https://api.open-meteo.com/v1/forecast?${query({
        latitude: String(lat), longitude: String(lon), start_date: ctx.trip.stay.start, end_date: end, timezone: 'auto',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration',
      })}`,
      { ttlMs: 3 * 3600_000 },
    ),
  );
  const d = res.daily;
  return {
    fetchedAt: ctx.now.toISOString(),
    days: d.time.map((date, i) => ({
      date,
      tmax: d.temperature_2m_max?.[i] ?? null,
      tmin: d.temperature_2m_min?.[i] ?? null,
      precip: d.precipitation_sum?.[i] ?? null,
      sunshine_h: d.sunshine_duration?.[i] == null ? null : Math.round((d.sunshine_duration[i]! / 3600) * 10) / 10,
    })),
  };
}

export const weatherProvider: CacheProvider<Weather> = {
  name: 'weather',
  file: 'weather.json',
  // History never changes; a forecast goes stale daily once the stay is close.
  ttlDays: (ctx) => (forecastWanted(ctx.now, ctx.trip) ? 1 : TTL_DAYS.weather),
  fingerprint: ({ meta, trip }) =>
    JSON.stringify([meta.resolved.lat.toFixed(2), meta.resolved.lon.toFixed(2), trip.stay.start, trip.stay.end, trip.weather_history_years]),
  parse: (json) => WeatherSchema.parse(json),

  async run(ctx) {
    const { lat, lon } = ctx.meta.resolved;
    const window = windowDates(ctx.trip);
    const wanted = historyYears(ctx.now, ctx.trip.weather_history_years);

    const raw: Record<string, RawYear> = {};
    let timezone = 'UTC';
    for (const year of wanted) {
      try {
        const res = await fetchYear(lat, lon, year, window);
        raw[String(year)] = res.raw;
        timezone = res.timezone;
      } catch (err) {
        console.warn(`[weather] ${ctx.entry.slug} ${year} skipped: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (Object.keys(raw).length < MIN_YEARS) {
      throw new Error(`only ${Object.keys(raw).length} of ${wanted.length} years available`);
    }

    let forecast: Weather['forecast'] = null;
    if (forecastWanted(ctx.now, ctx.trip)) {
      try {
        forecast = await fetchForecast(lat, lon, ctx);
      } catch (err) {
        console.warn(`[weather] forecast unavailable: ${err instanceof Error ? err.message : err}`);
      }
    }

    const { daily, summary } = aggregate(raw, window.days, stayDays(ctx.trip));
    return {
      fetchedAt: ctx.now.toISOString(),
      fingerprint: this.fingerprint(ctx),
      provider: 'open-meteo',
      timezone,
      years: Object.keys(raw).map(Number),
      window,
      tripDays: stayDays(ctx.trip),
      raw,
      daily,
      summary,
      forecast,
    };
  },
};
