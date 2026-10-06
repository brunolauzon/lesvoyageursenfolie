import { describe, expect, it } from 'vitest';
import { doorToDoor, estimateFlightMinutes, estimateTransferMinutes, formatDuration, pickAirport } from '../src/lib/travel';
import { utcOffsetHours } from '../src/lib/tz';
import { isoDurationMinutes } from '../scripts/providers/amadeus';
import type { Travel } from '../src/schema/travel';

const airports = [
  { iata: 'VRA', lat: 23.03, lon: -81.43 },
  { iata: 'HAV', lat: 22.99, lon: -82.41 },
  { iata: 'SNU', lat: 22.49, lon: -79.94 },
];
const varadero = { lat: 23.1, lon: -81.2 };

describe('pickAirport', () => {
  it('prefers an airport with flights from YUL over a nearer one without', () => {
    const r = pickAirport(varadero, airports, new Set(['HAV']));
    expect(r.airport.iata).toBe('HAV');
    expect(r.choice).toBe('nearest-with-flights');
  });
  it('falls back to the nearest airport', () => {
    expect(pickAirport(varadero, airports, new Set()).choice).toBe('nearest');
  });
  it('lets an override win, and rejects unknown codes', () => {
    expect(pickAirport(varadero, airports, new Set(['VRA']), 'snu').airport.iata).toBe('SNU');
    expect(() => pickAirport(varadero, airports, new Set(), 'ZZZ')).toThrow(/Unknown airport/);
  });
});

describe('doorToDoor', () => {
  const travel = { flight: { minutes: 230 }, transfer: { minutes: 40 } } as Travel;
  const cfg = { home_to_airport_min: 30, checkin_buffer_min: 120, arrival_buffer_min: 60, transfer_margin_pct: 15 };
  it('adds buffers and applies the margin to the transfer only', () => {
    const d = doorToDoor(travel, cfg);
    expect(d.transfer).toBe(46);
    expect(d.total).toBe(30 + 120 + 230 + 60 + 46);
  });
});

describe('estimates and formatting', () => {
  it('estimates flight and transfer times', () => {
    expect(estimateFlightMinutes(800)).toBe(90);
    expect(estimateTransferMinutes(25)).toBe(30);
  });
  it('formats durations', () => {
    expect(formatDuration(425)).toBe('7 h 05');
    expect(formatDuration(45)).toBe('45 min');
  });
  it('parses ISO durations', () => {
    expect(isoDurationMinutes('PT4H25M')).toBe(265);
    expect(isoDurationMinutes('PT45M')).toBe(45);
  });
  it('computes DST-aware offsets', () => {
    expect(utcOffsetHours('America/Toronto', new Date('2027-01-16T12:00:00Z'))).toBe(-5);
    expect(utcOffsetHours('America/Santo_Domingo', new Date('2027-01-16T12:00:00Z'))).toBe(-4);
    expect(utcOffsetHours('Europe/London', new Date('2027-01-16T12:00:00Z'))).toBe(0);
  });
});
