import { z } from 'zod';
import { FIELDS, valueSchema } from './facility-fields';

/**
 * data/overrides/<slug>.yml. One optional key per facility field (see src/schema/facility-fields.ts),
 * plus `airport` and `note`. `null` means "unknown: hide whatever was fetched".
 */
export const OverrideSchema = z
  .object({
    /** IATA code of the arrival airport, when the nearest one is not the one with flights from YUL. */
    airport: z.string().length(3).optional(),
    note: z.string().optional(),
    ...Object.fromEntries(FIELDS.map((f) => [f.key, valueSchema(f).nullable().optional()])),
  })
  .strict();

export type Override = z.infer<typeof OverrideSchema> & Record<string, unknown>;
