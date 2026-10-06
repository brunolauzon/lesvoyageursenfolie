import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const CountrySchema = z.object({
  name: z.string(),
  currency: z.string(),
  plugs: z.array(z.string()),
  voltage: z.string(),
  language: z.string(),
  advisory: z.string(),
});
export type Country = z.infer<typeof CountrySchema>;

/** data/reference/countries.yml, keyed by the country name as returned by the resolver or an ISO code. */
export function loadCountries(): Record<string, Country> {
  const file = join(process.cwd(), 'data', 'reference', 'countries.yml');
  return z.record(z.string(), CountrySchema).parse(parse(readFileSync(file, 'utf8'), { schema: 'core' }));
}

/** Look up by ISO 3166-1 alpha-2 code (the airport table carries it). */
export const findCountry = (countries: Record<string, Country>, iso: string | null | undefined): Country | null =>
  (iso && countries[iso.toUpperCase()]) || null;
