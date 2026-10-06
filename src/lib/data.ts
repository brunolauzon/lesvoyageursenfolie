import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { TripSchema, type Trip } from '../schema/trip';
import { ResortInputListSchema, type ResortInput } from '../schema/resort-input';
import { slugify } from './slugify';

// Astro bundles this module into dist/, so resolve from the project root, not import.meta.url.
const dataDir = join(process.cwd(), 'data');

function readYaml(file: string): unknown {
  return parse(readFileSync(join(dataDir, file), 'utf8'), { schema: 'core' });
}

export function loadTrip(): Trip {
  return TripSchema.parse(readYaml('trip.yml'));
}

export type ResortEntry = ResortInput & { slug: string };

export function loadResortInputs(): ResortEntry[] {
  const list = ResortInputListSchema.parse(readYaml('resorts.yml')).map((r) => ({
    ...r,
    slug: slugify(r.name),
  }));
  const seen = new Set<string>();
  for (const { slug, name } of list) {
    if (seen.has(slug)) throw new Error(`Doublon dans resorts.yml : « ${name} » (${slug})`);
    seen.add(slug);
  }
  return list;
}
