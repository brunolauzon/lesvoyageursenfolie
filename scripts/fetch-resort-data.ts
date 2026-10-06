/**
 * Prebuild orchestrator. A no-op when the committed cache is fresh.
 *   npm run fetch -- --force            refresh everything
 *   npm run fetch -- --resort <slug>    refresh one resort
 * Only the resolve step may fail the build; provider failures keep the previous cache.
 */
import { parseArgs } from 'node:util';
import { loadMeta, loadResortInputs, loadTrip, type ResortEntry } from '../src/lib/data';
import type { Meta } from '../src/schema/meta';
import { writeCacheJson } from './lib/cache';
import { configureHttp } from './lib/http';
import { writeReport } from './lib/report';
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

/** Returns true when something was fetched. */
async function refresh(entry: ResortEntry): Promise<boolean> {
  const previous = readPrevious(entry.slug);
  const sameInput = previous?.inputHash === hashInput(entry);
  if (previous && sameInput && !values.force && isFresh(previous.fetchedAt, resolveTtl(previous))) return false;

  console.log(`[fetch] ${entry.slug}: resolving...`);
  try {
    const meta = await resolveResort(entry);
    writeCacheJson(entry.slug, 'meta.json', meta);
    console.log(`[fetch] ${entry.slug}: ${meta.resolved.name} (${meta.provider}, confidence ${meta.confidence})`);
    return true;
  } catch (err) {
    // A refresh of unchanged input must not break a build that already has good data.
    if (err instanceof ResolveError && previous && sameInput) {
      console.warn(`[fetch] ${entry.slug}: refresh failed, keeping previous data.\n${err.message}`);
      return false;
    }
    throw err;
  }
}

async function main() {
  loadTrip();
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
