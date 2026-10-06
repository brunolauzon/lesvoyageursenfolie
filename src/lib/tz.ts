/** UTC offset in hours of an IANA zone at a given instant, via Intl (DST-aware). */
export function utcOffsetHours(timeZone: string, at: Date): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = part?.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0; // plain "GMT"
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3] ?? 0) / 60);
}
