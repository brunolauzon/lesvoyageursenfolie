// Plain-language layer: turns numbers into words and finds who wins each criterion.
import type { Resort } from './resorts';
import { duration } from './format';

/** Word for the January daytime temperature. Thresholds are shown in the reading guide. */
export function tempLabel(max: number | null | undefined): string | null {
  if (max == null) return null;
  if (max >= 28) return 'Très chaud';
  if (max >= 25) return 'Chaud';
  return 'Doux';
}

/** Word for the share of days with rain (1 mm or more, so light showers count). */
export function rainLabel(pct: number | null | undefined): string | null {
  if (pct == null) return null;
  if (pct <= 25) return 'Plutôt sec';
  if (pct <= 45) return 'Quelques averses';
  return 'Averses fréquentes';
}

/** Two short sentences: how long it takes, and what the weather is like. */
export function summaryOf(r: Resort): string {
  const t = r.logistiqueTransport;
  const m = r.meteoHistoriqueJanvier16;
  const parts: string[] = [];
  if (t?.tempsTrajetTotalMinutes != null && t.dureeVolMinutes != null && t.tempsTransfertMinutes != null) {
    parts.push(`${duration(t.tempsTrajetTotalMinutes)} de trajet : ${duration(t.dureeVolMinutes)} d’avion, puis ${duration(t.tempsTransfertMinutes)} de route.`);
  }
  if (m?.tempMaxC != null) {
    const rain = rainLabel(m.probabilitePluiePct)?.toLowerCase();
    parts.push(`En janvier : ${tempLabel(m.tempMaxC)?.toLowerCase()} (${m.tempMaxC} °C le jour)${rain ? `, ${rain}` : ''}.`);
  }
  return parts.join(' ');
}

export interface Winner {
  key: string;
  title: string;
  help: string;
  value: string;
  resorts: Resort[];
  icon: 'trip' | 'heat' | 'rain' | 'rating' | 'transfer';
}

interface Criterion {
  key: string;
  title: string;
  help: string;
  icon: Winner['icon'];
  better: 'min' | 'max';
  get: (r: Resort) => number | null | undefined;
  fmt: (v: number) => string;
}

const CRITERIA: Criterion[] = [
  { key: 'trip', title: 'Trajet le plus court', help: 'Avion + route, sans les attentes à l’aéroport', icon: 'trip', better: 'min', get: (r) => r.logistiqueTransport?.tempsTrajetTotalMinutes, fmt: duration },
  { key: 'heat', title: 'Le plus chaud', help: 'Température du jour, 16 au 23 janvier', icon: 'heat', better: 'max', get: (r) => r.meteoHistoriqueJanvier16?.tempMaxC, fmt: (v) => `${v} °C` },
  { key: 'rain', title: 'Le moins de pluie', help: 'Part des jours avec de la pluie, même légère', icon: 'rain', better: 'min', get: (r) => r.meteoHistoriqueJanvier16?.probabilitePluiePct, fmt: (v) => `${v} %` },
  { key: 'rating', title: 'Le mieux noté', help: 'Note des voyageurs, sur 5', icon: 'rating', better: 'max', get: (r) => r.noteGenerale, fmt: (v) => `${v.toFixed(1).replace('.', ',')}/5` },
  { key: 'transfer', title: 'Route la plus courte', help: 'De l’aéroport au resort, en voiture', icon: 'transfer', better: 'min', get: (r) => r.logistiqueTransport?.tempsTransfertMinutes, fmt: duration },
];

/** Up to four criteria where at least two resorts have a value and they differ. Ties share the win. */
export function winners(resorts: Resort[]): Winner[] {
  const out: Winner[] = [];
  for (const c of CRITERIA) {
    const known = resorts.map((r) => ({ r, v: c.get(r) })).filter((x): x is { r: Resort; v: number } => typeof x.v === 'number');
    if (known.length < 2) continue;
    const values = known.map((x) => x.v);
    if (Math.min(...values) === Math.max(...values)) continue;
    const best = c.better === 'min' ? Math.min(...values) : Math.max(...values);
    out.push({ key: c.key, title: c.title, help: c.help, icon: c.icon, value: c.fmt(best), resorts: known.filter((x) => x.v === best).map((x) => x.r) });
  }
  return out.slice(0, 4);
}

/** French names of the facility fields, for provenance notes. */
export const INFRA_LABELS: Record<string, string> = {
  noteGenerale: 'Note des voyageurs',
  nombreAvis: 'Nombre d’avis',
  etoiles: 'Étoiles',
  siteOfficiel: 'Site officiel',
  lienTripadvisor: 'Page TripAdvisor',
  qualitePlage: 'Plage',
  nombrePiscines: 'Piscines',
  clubEnfants: 'Club enfants',
  parcAquatique: 'Parc aquatique',
  nombreRestaurants: 'Restaurants',
  nombreBars: 'Bars',
  qualiteWifi: 'Wi-Fi',
  spaSurPlace: 'Spa',
  serviceChambre24h: 'Repas à la chambre, 24 h sur 24',
};
