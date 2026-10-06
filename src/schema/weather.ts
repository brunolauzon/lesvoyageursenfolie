import { z } from 'zod';

const series = z.array(z.number().nullable());

/** One year of the window, as returned by the APIs (units kept: sunshine in seconds). */
export const RawYearSchema = z.object({ dates: z.array(z.string()) }).catchall(series);

export const StatSchema = z.object({
  mean: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  p10: z.number().nullable(),
  p90: z.number().nullable(),
  n: z.number(),
});

export const VARS = ['tmax', 'tmin', 'precip', 'sunshine_h', 'wind', 'humidity', 'uv', 'cloud', 'sst'] as const;
export type WeatherVar = (typeof VARS)[number];

export const DailySchema = z.object({
  md: z.string(),
  stats: z.record(z.string(), StatSchema),
  /** Share of years with more than 1 mm of precipitation that day. */
  rainyShare: z.number().nullable(),
  /** Share of years with at least 6 h of sunshine that day. */
  sunnyShare: z.number().nullable(),
});

export const SummarySchema = z.object({
  yearsUsed: z.number(),
  avgHigh: z.number().nullable(),
  avgLow: z.number().nullable(),
  rainyDayPct: z.number().nullable(),
  precipMmPerDay: z.number().nullable(),
  sunshineHoursPerDay: z.number().nullable(),
  sunnyDayPct: z.number().nullable(),
  windKmh: z.number().nullable(),
  uvIndex: z.number().nullable(),
  seaTemp: z.number().nullable(),
  humidityPct: z.number().nullable(),
  cloudPct: z.number().nullable(),
});

export const ForecastDaySchema = z.object({
  date: z.string(),
  tmax: z.number().nullable(),
  tmin: z.number().nullable(),
  precip: z.number().nullable(),
  sunshine_h: z.number().nullable(),
});

/** data/cache/<slug>/weather.json */
export const WeatherSchema = z.object({
  fetchedAt: z.iso.datetime(),
  fingerprint: z.string(),
  provider: z.literal('open-meteo'),
  timezone: z.string(),
  years: z.array(z.number()),
  window: z.object({ start: z.string(), end: z.string(), days: z.array(z.string()) }),
  tripDays: z.array(z.string()),
  raw: z.record(z.string(), RawYearSchema),
  daily: z.array(DailySchema),
  summary: SummarySchema,
  forecast: z.object({ fetchedAt: z.iso.datetime(), days: z.array(ForecastDaySchema) }).nullable(),
});

export type Weather = z.infer<typeof WeatherSchema>;
export type RawYear = z.infer<typeof RawYearSchema>;
export type DailyStats = z.infer<typeof DailySchema>;
export type WeatherSummary = z.infer<typeof SummarySchema>;
