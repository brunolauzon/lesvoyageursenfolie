import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { TripSchema, type Trip } from '../schema/trip';
import { ResortInputListSchema, type ResortInput } from '../schema/resort-input';
import { MetaSchema, type Meta } from '../schema/meta';
import { WeatherSchema, type Weather } from '../schema/weather';
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
    if (seen.has(slug)) throw new Error(`Duplicate entry in resorts.yml: "${name}" (${slug})`);
    seen.add(slug);
  }
  return list;
}

export const cacheRoot = join(process.cwd(), 'data', 'cache');

/** Reads data/cache/<slug>/meta.json. Null when the resort has not been resolved yet. */
export function loadMeta(slug: string): Meta | null {
  const file = join(cacheRoot, slug, 'meta.json');
  if (!existsSync(file)) return null;
  return MetaSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

function loadCache<T>(slug: string, file: string, schema: { parse(x: unknown): T }): T | null {
  const path = join(cacheRoot, slug, file);
  return existsSync(path) ? schema.parse(JSON.parse(readFileSync(path, 'utf8'))) : null;
}

export const loadWeather = (slug: string): Weather | null => loadCache(slug, 'weather.json', WeatherSchema);
