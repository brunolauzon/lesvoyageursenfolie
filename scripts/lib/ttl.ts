export const TTL_DAYS = {
  resolve: 365,
  /** Google's terms only allow caching coordinates for 30 days. */
  resolveGoogleCoords: 30,
  facilities: 30,
  weather: 365,
  travel: 14,
} as const;

export function isFresh(fetchedAt: string, ttlDays: number, now = Date.now()): boolean {
  const t = Date.parse(fetchedAt);
  return Number.isFinite(t) && now - t < ttlDays * 86_400_000;
}
