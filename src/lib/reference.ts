import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { AirportSchema, FlightTimesSchema, type Airport, type FlightTime } from '../schema/travel';

const refDir = join(process.cwd(), 'data', 'reference');

export function loadFlightTimes(): FlightTime[] {
  return FlightTimesSchema.parse(parse(readFileSync(join(refDir, 'flight-times.yml'), 'utf8'), { schema: 'core' }) ?? []).map((f) => ({
    ...f,
    airport: f.airport.toUpperCase(),
    minutes: Number(f.minutes),
  }));
}

export function loadAirports(): Airport[] {
  const [, ...rows] = readFileSync(join(refDir, 'airports.csv'), 'utf8').trim().split('\n');
  // The file is written by our own script: only the name can contain a quoted comma.
  return rows.map((line) => {
    const f = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((s) => s.replace(/,$/, '').replace(/^"|"$/g, '').replaceAll('""', '"'));
    return AirportSchema.parse({ iata: f[0], name: f[1], lat: Number(f[2]), lon: Number(f[3]), country: f[4], municipality: f[5] });
  });
}
