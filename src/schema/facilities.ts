import { z } from 'zod';

export const SOURCES = ['override', 'manual', 'official', 'osm', 'wikidata', 'llm'] as const;
export type Source = (typeof SOURCES)[number];

export const EntrySchema = z.object({
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  /** page the value came from */
  url: z.string().nullable().optional(),
});

export const ProviderResultSchema = z.object({
  fetchedAt: z.iso.datetime(),
  fields: z.record(z.string(), EntrySchema),
});

export const PhotoSchema = z.object({
  url: z.string(),
  source: z.enum(['official', 'wikimedia']),
  pageUrl: z.string().nullable(),
  title: z.string().nullable(),
  author: z.string().nullable(),
  license: z.string().nullable(),
  licenseUrl: z.string().nullable(),
  /** false when picked by proximity only, not linked to the hotel by a Wikidata statement */
  verified: z.boolean(),
});

/** data/cache/<slug>/facilities.json: raw results per provider; merged with overrides at load time. */
export const FacilitiesCacheSchema = z.object({
  fetchedAt: z.iso.datetime(),
  fingerprint: z.string(),
  providers: z.record(z.string(), ProviderResultSchema),
  photos: z.array(PhotoSchema),
  /** pages read on the official site */
  pages: z.array(z.string()),
});

export type Photo = z.infer<typeof PhotoSchema>;
export type ProviderResult = z.infer<typeof ProviderResultSchema>;
export type FacilitiesCache = z.infer<typeof FacilitiesCacheSchema>;

/** One merged fact with its provenance. */
export interface FieldValue {
  value: unknown;
  source: Source;
  confidence: number;
  /** null for hand-written values */
  fetchedAt: string | null;
  url: string | null;
}
