// Turns the stored January data (average per day + every past year) into things a person can read:
// a weather symbol per day, and "how many of the last 5 years had rain that day".
import { Cloud, CloudDrizzle, CloudRain, CloudSun, Sun } from 'lucide-react';
import type { Resort } from './resorts';

export type Cond = 'sun' | 'partly' | 'cloud' | 'drizzle' | 'rain';

export const COND = {
  sun: { label: 'Ensoleillé', Icon: Sun, color: 'text-sun' },
  partly: { label: 'Éclaircies', Icon: CloudSun, color: 'text-sun' },
  cloud: { label: 'Nuageux', Icon: Cloud, color: 'text-muted' },
  drizzle: { label: 'Averse légère', Icon: CloudDrizzle, color: 'text-rain' },
  rain: { label: 'Pluie', Icon: CloudRain, color: 'text-rain' },
} as const;

const ORDER: Cond[] = ['sun', 'partly', 'cloud', 'drizzle', 'rain'];

/** Rain wins (5 mm or more: rain, 1 to 5 mm: light shower), then cloud cover decides. */
export function condition(precipMm: number | null | undefined, cloudPct: number | null | undefined): Cond | null {
  if (precipMm == null && cloudPct == null) return null;
  if ((precipMm ?? 0) >= 5) return 'rain';
  if ((precipMm ?? 0) >= 1) return 'drizzle';
  if ((cloudPct ?? 0) >= 60) return 'cloud';
  if ((cloudPct ?? 0) >= 30) return 'partly';
  return 'sun';
}

/** A day is marked by a coloured edge: yellow for sun, blue for rain, nothing for plain cloud. */
export function tint(c: Cond | null): string {
  if (c === 'sun' || c === 'partly') return 'bg-ink/[0.08] border-t-[3px] border-t-sun';
  if (c === 'drizzle' || c === 'rain') return 'bg-ink/[0.08] border-t-[3px] border-t-rain';
  return 'bg-ink/[0.05] border-t-[3px] border-t-ink/20';
}

export const isWet = (c: Cond | null) => c === 'drizzle' || c === 'rain';
export const isNice = (c: Cond | null) => c === 'sun' || c === 'partly';

export interface DayYear {
  annee: number;
  max: number | null;
  min: number | null;
  mm: number | null;
  cond: Cond | null;
  wet: boolean;
}

export interface Day {
  date: string;
  weekday: string;
  weekdayLong: string;
  num: number;
  max: number | null;
  min: number | null;
  maxLow: number | null;
  maxHigh: number | null;
  minLow: number | null;
  minHigh: number | null;
  years: DayYear[];
  rainYears: number | null;
  typical: Cond | null;
}

const fmt = (weekday: 'short' | 'long', d: Date) => new Intl.DateTimeFormat('fr-CA', { weekday, timeZone: 'UTC' }).format(d).replace(/\.$/, '');

type MeteoBlock = NonNullable<Resort['meteoHistoriqueJanvier16']>;
type LooseMeteo = { parJour?: MeteoBlock['parJour']; parAnnee?: MeteoBlock['parAnnee'] } | null | undefined;

/** True when rain showed up in at least half of the past years on that date. */
export const likelyWet = (d: Day) => d.rainYears != null && d.years.length > 0 && d.rainYears * 2 >= d.years.length;

/** The 8 days of the trip (Saturday 16 to Saturday 23 January 2027) with what happened on each date in past years. */
export function weekOfMeteo(m: LooseMeteo): Day[] {
  return (m?.parJour ?? []).map((p, i) => {
    const date = new Date(Date.UTC(2027, 0, 16 + i, 12));
    const years: DayYear[] = (m?.parAnnee ?? [])
      .filter((y) => y.jours[i])
      .map((y) => {
        const j = y.jours[i];
        const cond = condition(j.precipMm, j.nuagesPct);
        return { annee: y.annee, max: j.tempMaxC ?? null, min: j.tempMinC ?? null, mm: j.precipMm ?? null, cond, wet: (j.precipMm ?? 0) >= 1 };
      });

    // Rain wins when at least half the years had it (so the symbol always agrees with "rain 3 years out of 5").
    // Otherwise the most common dry look of that date. On a tie, the wetter one (better to be warned).
    let typical: Cond | null = condition(p.precipMm, p.couvertureNuageusePct);
    if (years.length) {
      const pool = years.filter((y) => y.cond);
      const wetYears = pool.filter((y) => y.wet);
      const chosen = wetYears.length * 2 >= years.length && wetYears.length > 0 ? wetYears : pool.filter((y) => !y.wet);
      const counts = new Map<Cond, number>();
      for (const y of chosen) if (y.cond) counts.set(y.cond, (counts.get(y.cond) ?? 0) + 1);
      typical = [...counts.entries()].sort((a, b) => b[1] - a[1] || ORDER.indexOf(b[0]) - ORDER.indexOf(a[0]))[0]?.[0] ?? typical;
    }
    return {
      date: p.date,
      weekday: fmt('short', date),
      weekdayLong: fmt('long', date),
      num: 16 + i,
      max: p.tempMaxC ?? null,
      min: p.tempMinC ?? null,
      maxLow: p.tempMaxBasC ?? null,
      maxHigh: p.tempMaxHautC ?? null,
      minLow: p.tempMinBasC ?? null,
      minHigh: p.tempMinHautC ?? null,
      years,
      rainYears: years.length ? years.filter((y) => y.wet).length : null,
      typical,
    };
  });
}

export const weekOf = (r: Resort): Day[] => weekOfMeteo(r.meteoHistoriqueJanvier16);
