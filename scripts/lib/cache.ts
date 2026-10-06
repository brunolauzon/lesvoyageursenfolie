import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheRoot } from '../../src/lib/data';

/** Stable formatting keeps committed cache diffs minimal. */
export function writeCacheJson(slug: string, file: string, data: unknown): void {
  const dir = join(cacheRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), `${JSON.stringify(data, null, 2)}\n`);
}
