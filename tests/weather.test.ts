import { describe, expect, it } from 'vitest';
import { percentile } from '../src/lib/stats';
import { addDays, forecastWanted, historyYears, nights, stayDays, windowDates } from '../src/lib/dates';
import { aggregate } from '../src/lib/weather-aggregate';
import { TripSchema } from '../src/schema/trip';
import type { RawYear } from '../src/schema/weather';

const trip = TripSchema.parse({
  origin: { airport: 'YUL', lat: 45.47, lon: -73.74 },
  travelers: 2,
  stay: { start: '2027-01-16', end: '2027-01-23' },
  currency: 'CAD',
  locale: 'fr-CA',
  weather_history_years: 10,
});

describe('stats', () => {
  it('interpolates percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.1)).toBe(1);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('dates', () => {
  it('builds the stay and chart window from the trip', () => {
    expect(nights(trip)).toBe(7);
    expect(stayDays(trip)).toEqual(['01-16', '01-17', '01-18', '01-19', '01-20', '01-21', '01-22']);
    const w = windowDates(trip);
    expect([w.start, w.end, w.days.length]).toEqual(['2027-01-09', '2027-01-29', 21]);
  });
  it('crosses month ends', () => expect(addDays('2027-01-31', 1)).toBe('2027-02-01'));
  it('uses the last complete years', () => {
    expect(historyYears(new Date('2026-10-06T00:00:00Z'), 3)).toEqual([2023, 2024, 2025]);
  });
  it('wants a forecast only within 14 days of the stay', () => {
    expect(forecastWanted(new Date('2026-10-06T00:00:00Z'), trip)).toBe(false);
    expect(forecastWanted(new Date('2027-01-02T00:00:00Z'), trip)).toBe(true);
    expect(forecastWanted(new Date('2027-01-24T00:00:00Z'), trip)).toBe(false);
  });
});

describe('aggregate', () => {
  const year = (offset: number): RawYear => ({
    dates: ['2020-01-16', '2020-01-17'],
    temperature_2m_max: [25 + offset, 27 + offset],
    temperature_2m_min: [20, 21],
    precipitation_sum: [0, 5 * offset],
    sunshine_duration: [36000, 10800], // 10 h and 3 h
    sea_surface_temperature: [null, null],
  });
  const { daily, summary } = aggregate({ a: year(0), b: year(2) }, ['01-16', '01-17'], ['01-16', '01-17']);

  it('averages per calendar day across years', () => {
    expect(daily[0]!.stats.tmax).toMatchObject({ mean: 26, min: 25, max: 27, n: 2 });
  });
  it('computes rainy and sunny shares', () => {
    expect(daily[1]!.rainyShare).toBe(0.5); // 0 mm and 10 mm
    expect(daily[0]!.sunnyShare).toBe(1);
    expect(daily[1]!.sunnyShare).toBe(0);
  });
  it('summarises the stay and leaves unknown values null', () => {
    expect(summary.avgHigh).toBe(27);
    expect(summary.rainyDayPct).toBe(25);
    expect(summary.sunshineHoursPerDay).toBe(6.5);
    expect(summary.seaTemp).toBeNull();
    expect(summary.uvIndex).toBeNull();
  });
});
