import type { ResortEntry } from '../../src/lib/data';
import type { Override } from '../../src/schema/override';
import type { Meta } from '../../src/schema/meta';
import type { Trip } from '../../src/schema/trip';

export interface ProviderCtx {
  entry: ResortEntry;
  meta: Meta;
  trip: Trip;
  override: Override | null;
  now: Date;
}

/** A cache file in data/cache/<slug>/ that the orchestrator keeps fresh. */
export interface CacheProvider<T extends { fetchedAt: string; fingerprint: string }> {
  name: string;
  file: string;
  ttlDays(ctx: ProviderCtx): number;
  /** Changes when the inputs of this provider change (coordinates, dates, hints): forces a refetch. */
  fingerprint(ctx: ProviderCtx): string;
  parse(json: unknown): T;
  run(ctx: ProviderCtx, previous: T | null): Promise<T>;
}
