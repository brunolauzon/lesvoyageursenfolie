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
  /** Default 0-10 weights of the "which one should we pick" score. */
  score_weights: z
    .object({
      weather: z.number().min(0).max(10).default(8),
      travel: z.number().min(0).max(10).default(5),
      beach: z.number().min(0).max(10).default(6),
      food: z.number().min(0).max(10).default(5),
      pool: z.number().min(0).max(10).default(5),
      kids: z.number().min(0).max(10).default(0),
      price: z.number().min(0).max(10).default(6),
      rating: z.number().min(0).max(10).default(6),
      activities: z.number().min(0).max(10).default(3),
    })
    .prefault({}),
});

export type Trip = z.infer<typeof TripSchema>;
