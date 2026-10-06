/**
 * Prebuild orchestrator. A no-op when the committed cache is fresh.
 *   npm run fetch -- --force            refresh everything
 *   npm run fetch -- --resort <slug>    refresh one resort
 * Only the resolve step may fail the build; provider failures keep the previous cache.
 */
import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheRoot, loadMeta, loadResortInputs, loadTrip, type ResortEntry } from '../src/lib/data';
import { loadOverride } from '../src/lib/overrides';
import type { Meta } from '../src/schema/meta';
import { writeCacheJson } from './lib/cache';
import { configureHttp } from './lib/http';
import type { CacheProvider, ProviderCtx } from './lib/provider';
import { writeReport } from './lib/report';
import { travelProvider } from './providers/travel';
import { weatherProvider } from './providers/weather';
import { TTL_DAYS, isFresh } from './lib/ttl';
import { ResolveError, hashInput, resolveResort } from './providers/resolve';

const { values } = parseArgs({
  options: { force: { type: 'boolean', default: false }, resort: { type: 'string' } },
});
configureHttp({ force: values.force });

const resolveTtl = (m: Meta) => (m.fields.lat?.source === 'google' ? TTL_DAYS.resolveGoogleCoords : TTL_DAYS.resolve);

function readPrevious(slug: string): Meta | null {
  try {
    return loadMeta(slug);
  } catch {
    console.warn(`[fetch] ${slug}: meta.json is invalid, ignoring it`);
    return null;
  }
}

const PROVIDERS: CacheProvider<any>[] = [weatherProvider, travelProvider];

function readCache<T extends { fetchedAt: string; fingerprint: string }>(slug: string, p: CacheProvider<T>): T | null {
  const file = join(cacheRoot, slug, p.file);
  if (!existsSync(file)) return null;
  try {
    return p.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    console.warn(`[fetch] ${slug}/${p.file} is invalid, refetching`);
    return null;
  }
}

/** Refresh one cache file. A failure never fails the build: the previous file stays. */
async function refreshProvider(ctx: ProviderCtx, p: CacheProvider<any>): Promise<boolean> {
  const previous = readCache(ctx.entry.slug, p);
  const fresh =
    previous && previous.fingerprint === p.fingerprint(ctx) && isFresh(previous.fetchedAt, p.ttlDays(ctx), ctx.now.getTime());
  if (fresh && !values.force) return false;
  console.log(`[fetch] ${ctx.entry.slug}: ${p.name}...`);
  try {
    writeCacheJson(ctx.entry.slug, p.file, await p.run(ctx, previous));
    return true;
  } catch (err) {
    console.warn(`[fetch] ${ctx.entry.slug}: ${p.name} failed (${err instanceof Error ? err.message : err}), ${previous ? 'keeping previous data' : 'no data yet'}`);
    return false;
  }
}

/** Returns true when something was fetched. */
async function refresh(entry: ResortEntry): Promise<boolean> {
  const previous = readPrevious(entry.slug);
  const sameInput = previous?.inputHash === hashInput(entry);
  let changed = false;
  let meta = previous;

  if (!(previous && sameInput && !values.force && isFresh(previous.fetchedAt, resolveTtl(previous)))) {
    console.log(`[fetch] ${entry.slug}: resolving...`);
    try {
      meta = await resolveResort(entry);
      writeCacheJson(entry.slug, 'meta.json', meta);
      console.log(`[fetch] ${entry.slug}: ${meta.resolved.name} (${meta.provider}, confidence ${meta.confidence})`);
      changed = true;
    } catch (err) {
      // A refresh of unchanged input must not break a build that already has good data.
      if (!(err instanceof ResolveError && previous && sameInput)) throw err;
      console.warn(`[fetch] ${entry.slug}: refresh failed, keeping previous data.\n${err.message}`);
    }
  }

  if (!meta) return changed;
  const ctx: ProviderCtx = { entry, meta, trip, override: loadOverride(entry.slug), now: new Date() };
  for (const p of PROVIDERS) changed = (await refreshProvider(ctx, p)) || changed;
  return changed;
}

const trip = loadTrip();

async function main() {
  const all = loadResortInputs();
  const targets = values.resort ? all.filter((r) => r.slug === values.resort) : all;
  if (values.resort && targets.length === 0) {
    console.error(`[fetch] Unknown resort "${values.resort}". Known slugs: ${all.map((r) => r.slug).join(', ')}`);
    process.exit(1);
  }

  const failures = new Map<string, string>();
  let fetched = 0;
  for (const entry of targets) {
    try {
      if (await refresh(entry)) fetched++;
    } catch (err) {
      failures.set(entry.slug, err instanceof Error ? err.message : String(err));
    }
  }
  writeReport(all, failures);

  if (failures.size) {
    for (const [slug, message] of failures) console.error(`\n[fetch] ${slug} FAILED\n${message}`);
    process.exit(1);
  }
  console.log(fetched ? `[fetch] ${fetched} resolved, report updated.` : `[fetch] ${targets.length} up to date, nothing to fetch.`);
}

await main();
