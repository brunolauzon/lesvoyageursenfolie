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
  travel: z
    .object({
      home_to_airport_min: z.number().nonnegative().default(0),
      checkin_buffer_min: z.number().nonnegative().default(120),
      arrival_buffer_min: z.number().nonnegative().default(60),
      transfer_margin_pct: z.number().nonnegative().default(15),
    })
    .prefault({}),
});

export type Trip = z.infer<typeof TripSchema>;
