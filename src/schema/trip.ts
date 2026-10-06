import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const TripSchema = z.object({
  origin: z.object({
    airport: z.string().length(3),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  travelers: z.number().int().positive(),
  stay: z.object({ start: isoDate, end: isoDate }),
  currency: z.string().length(3),
  locale: z.string(),
  weather_history_years: z.number().int().positive(),
});

export type Trip = z.infer<typeof TripSchema>;
