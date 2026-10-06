import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { OverrideSchema, type Override } from '../schema/override';

/** data/overrides/<slug>.yml: hand-written facts that always win over fetched data. */
export function loadOverride(slug: string): Override | null {
  const file = join(process.cwd(), 'data', 'overrides', `${slug}.yml`);
  if (!existsSync(file)) return null;
  const parsed: unknown = parse(readFileSync(file, 'utf8'), { schema: 'core' }) ?? {};
  const result = OverrideSchema.safeParse(parsed);
  if (!result.success) throw new Error(`Invalid data/overrides/${slug}.yml:\n${result.error.message}`);
  return result.data;
}
