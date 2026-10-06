/**
 * Rebuilds data/reference/airports.csv from the OurAirports dump (public domain).
 * Keeps only large/medium airports with scheduled service and an IATA code. Run rarely: npm run update-airports
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { csvEscape, parseCsv } from './lib/csv';
import { http } from './lib/http';

const SOURCE = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const KEEP = ['iata_code', 'name', 'latitude_deg', 'longitude_deg', 'iso_country', 'municipality', 'type'] as const;
const OUT = ['iata', 'name', 'lat', 'lon', 'country', 'municipality', 'type'];

const [header, ...rows] = parseCsv(await http(SOURCE, { ttlMs: 0, headers: { Accept: 'text/csv' } }));
const col = Object.fromEntries(header!.map((h, i) => [h, i])) as Record<string, number>;
for (const k of [...KEEP, 'scheduled_service']) if (col[k] === undefined) throw new Error(`Missing column ${k} in OurAirports dump`);

const kept = rows
  .filter((r) => ['large_airport', 'medium_airport'].includes(r[col.type!]!) && r[col.scheduled_service!] === 'yes' && r[col.iata_code!])
  .map((r) => KEEP.map((k) => r[col[k]!]!))
  .sort((a, b) => a[0]!.localeCompare(b[0]!));

const csv = [OUT, ...kept].map((r) => r.map(csvEscape).join(',')).join('\n');
writeFileSync(join(process.cwd(), 'data', 'reference', 'airports.csv'), `${csv}\n`);
console.log(`[airports] ${kept.length} airports written`);
