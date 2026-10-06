import type { ProviderCtx } from '../../lib/provider';
import type { Photo } from '../../../src/schema/facilities';

export interface FactEntry {
  value: unknown;
  confidence: number;
  url?: string | null;
}

export interface SubResult {
  fields: Record<string, FactEntry>;
  photos?: Photo[];
}

export type SubProvider = (ctx: ProviderCtx) => Promise<SubResult>;
