import { z } from 'zod';

/** Extended in the facilities phase with one optional key per facility field. */
export const OverrideSchema = z.object({
  /** IATA code of the arrival airport, when the nearest one is not the one with flights from YUL. */
  airport: z.string().length(3).optional(),
});

export type Override = z.infer<typeof OverrideSchema>;
