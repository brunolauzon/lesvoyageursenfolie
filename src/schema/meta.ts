import { z } from 'zod';

export const ProvenanceSchema = z.object({
  source: z.string(),
  confidence: z.number().min(0).max(1),
  fetchedAt: z.iso.datetime(),
});

export const ResolvedSchema = z.object({
  name: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  address: z.string().nullable(),
  country: z.string().nullable(),
  website: z.string().nullable(),
  googlePlaceId: z.string().nullable(),
  wikidataId: z.string().nullable(),
});

export const AlternativeSchema = z.object({
  provider: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  address: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

/** data/cache/<slug>/meta.json */
export const MetaSchema = z.object({
  slug: z.string(),
  /** Hash of name + location + url from resorts.yml; a change forces a re-resolve. */
  inputHash: z.string(),
  fetchedAt: z.iso.datetime(),
  provider: z.enum(['google', 'nominatim', 'wikidata']),
  confidence: z.number().min(0).max(1),
  resolved: ResolvedSchema,
  /** Provenance per field. Later phases add their own fields here. */
  fields: z.record(z.string(), ProvenanceSchema),
  alternatives: z.array(AlternativeSchema),
});

export type Meta = z.infer<typeof MetaSchema>;
export type Resolved = z.infer<typeof ResolvedSchema>;
