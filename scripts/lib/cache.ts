import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheRoot } from '../../src/lib/data';

/** Stable formatting keeps committed cache diffs minimal. */
export function writeCacheJson(slug: string, file: string, data: unknown): void {
  const dir = join(cacheRoot, slug);
  mkdirSync(dir, { recursive: true });
  const pretty = JSON.stringify(data, null, 2)
    // Scalar arrays on one line: raw weather years would otherwise be thousands of lines.
    .replace(/\[\s*((?:-?[\d.e+-]+|null|"[^"\n]*")(?:,\s*(?:-?[\d.e+-]+|null|"[^"\n]*"))*)\s*\]/g, (_, inner: string) => `[${inner.replace(/\s+/g, ' ')}]`);
  writeFileSync(join(dir, file), `${pretty}\n`);
}
