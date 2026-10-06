import { z } from 'zod';

export const ResortInputSchema = z.object({
  name: z.string().min(1),
  location: z.string().optional(),
  url: z.url().optional(),
  price_cad: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

export const ResortInputListSchema = z.array(ResortInputSchema).min(1);

export type ResortInput = z.infer<typeof ResortInputSchema>;
