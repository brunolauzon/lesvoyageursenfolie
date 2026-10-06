/**
 * Official hotel website: JSON-LD (schema.org Hotel), OpenGraph and the facilities page.
 * Respects robots.txt and a 1 req/s limit. Also returns the cleaned page text for the optional LLM step.
 */
import { FIELD_BY_KEY, validValue } from '../../../src/schema/facility-fields';
import type { Photo } from '../../../src/schema/facilities';
import { mapAmenity } from '../../lib/amenities';
import { http, USER_AGENT } from '../../lib/http';
import { isAllowed } from '../../lib/robots';
import { jsonLdNodes, links, metaContent, visibleText } from '../../lib/html';
import type { ProviderCtx } from '../../lib/provider';
import type { FactEntry, SubResult } from './types';

const LODGING_TYPES = /^(Hotel|Resort|LodgingBusiness|BedAndBreakfast|Hostel|Motel|VacationRental|Accommodation)$/i;
const FACILITY_LINK = /facilit|amenit|services?\b|installations|equipment|[ée]quipements|dining|restaurants?|activit|spa\b/i;
const MAX_EXTRA_PAGES = 2;
const OPTS = { intervalMs: 1000, ttlMs: 7 * 86_400_000, headers: { Accept: 'text/html,application/xhtml+xml' } } as const;
const AGENT_TOKEN = USER_AGENT.split('/')[0]!;

const asArray = (x: unknown): unknown[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
const num = (x: unknown): number | undefined => {
  const n = typeof x === 'object' && x !== null ? Number((x as { value?: unknown }).value) : Number(x);
  return Number.isFinite(n) ? n : undefined;
};
const text = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim() : undefined);
const truthy = (x: unknown): boolean | undefined => {
  if (typeof x === 'boolean') return x;
  if (typeof x === 'string') return /^(true|yes|oui)$/i.test(x) ? true : /^(false|no|non)$/i.test(x) ? false : undefined;
  return undefined;
};

/** Facts from one schema.org lodging node. */
export function factsFromJsonLd(node: Record<string, unknown>, url: string): Record<string, FactEntry> {
  const out: Record<string, FactEntry> = {};
  const put = (key: string, value: unknown, confidence: number) => {
    const def = FIELD_BY_KEY.get(key);
    if (def && value !== undefined && validValue(def, value) !== undefined && !(key in out)) out[key] = { value, confidence, url };
  };

  put('stars', num((node.starRating as Record<string, unknown> | undefined)?.ratingValue), 0.8);
  put('roomCount', num(node.numberOfRooms), 0.8);
  put('checkIn', text(node.checkinTime), 0.8);
  put('checkOut', text(node.checkoutTime), 0.8);
  put('pets', truthy(node.petsAllowed), 0.8);

  // A hotel quoting its own rating is marketing: keep it, but low enough to carry a "to verify" badge.
  const agg = node.aggregateRating as Record<string, unknown> | undefined;
  const best = num(agg?.bestRating) ?? 5;
  const rating = num(agg?.ratingValue);
  if (rating !== undefined && best > 0) put('rating', Math.round((rating / best) * 50) / 10, 0.4);
  put('reviewCount', num(agg?.reviewCount ?? agg?.ratingCount), 0.4);

  for (const f of asArray(node.amenityFeature) as Record<string, unknown>[]) {
    const name = text(f?.name);
    if (!name) continue;
    const present = truthy(f.value) ?? true;
    for (const hit of mapAmenity(name, present)) put(hit.key, hit.value, 0.7);
  }
  return out;
}

export async function officialSite(ctx: ProviderCtx): Promise<SubResult & { text: string; pages: string[] }> {
  const start = ctx.entry.url ?? ctx.meta.resolved.website;
  const empty = { fields: {}, text: '', pages: [] as string[] };
  if (!start) return empty;

  const origin = new URL(start).origin;
  let robots = '';
  try {
    robots = await http(`${origin}/robots.txt`, { ...OPTS, headers: { Accept: 'text/plain' } });
  } catch {
    /* no robots.txt: everything allowed */
  }
  const allowed = (u: string) => isAllowed(robots, new URL(u).pathname, AGENT_TOKEN);
  if (!allowed(start)) {
    console.warn(`[facilities] robots.txt disallows ${start}, skipping official site`);
    return empty;
  }

  const fields: Record<string, FactEntry> = {};
  const photos: Photo[] = [];
  const texts: string[] = [];
  const pages: string[] = [];

  const read = async (url: string) => {
    const html = await http(url, OPTS);
    pages.push(url);
    texts.push(`--- ${url} ---\n${visibleText(html, 12_000)}`);
    for (const node of jsonLdNodes(html)) {
      if (!asArray(node['@type']).some((t) => typeof t === 'string' && LODGING_TYPES.test(t))) continue;
      for (const [k, v] of Object.entries(factsFromJsonLd(node, url))) fields[k] ??= v;
    }
    const og = metaContent(html, 'og:image');
    if (og && photos.length === 0) {
      try {
        photos.push({ url: new URL(og, url).href, source: 'official', pageUrl: url, title: ctx.meta.resolved.name, author: null, license: null, licenseUrl: null, verified: true });
      } catch {
        /* bad og:image */
      }
    }
    return html;
  };

  const home = await read(start);
  const extra = links(home, start)
    .filter((l) => new URL(l.href).origin === origin && l.href !== start && FACILITY_LINK.test(`${l.text} ${new URL(l.href).pathname}`) && allowed(l.href))
    .map((l) => l.href);
  for (const url of [...new Set(extra)].slice(0, MAX_EXTRA_PAGES)) {
    try {
      await read(url);
    } catch (err) {
      console.warn(`[facilities] ${url}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { fields, photos, text: texts.join('\n\n'), pages };
}
