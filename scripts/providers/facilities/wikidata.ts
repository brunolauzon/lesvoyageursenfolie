/** Wikidata facts and freely licensed photos from Wikimedia Commons (with author and licence). */
import { z } from 'zod';
import type { Photo } from '../../../src/schema/facilities';
import { httpJson } from '../../lib/http';
import type { ProviderCtx } from '../../lib/provider';
import type { FactEntry, SubResult } from './types';

const WD = 'https://www.wikidata.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const TTL = 30 * 86_400_000;
const GEO_RADIUS_M = 300;
const MAX_PHOTOS = 3;
const FREE_LICENSE = /^(CC[ -]|Public domain|PD|GFDL)/i;

const Snak = z.array(z.object({ mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).optional() }) }));
const EntitySchema = z.object({
  entities: z.record(z.string(), z.object({ claims: z.record(z.string(), Snak).optional(), labels: z.record(z.string(), z.object({ value: z.string() })).optional() })),
});
const ImageInfoPage = z.object({
  title: z.string(),
  imageinfo: z.array(z.object({
    thumburl: z.string().optional(),
    descriptionurl: z.string().optional(),
    mime: z.string().optional(),
    extmetadata: z.record(z.string(), z.object({ value: z.unknown().optional() })).optional(),
  })).optional(),
});
const CommonsSchema = z.object({ query: z.object({ pages: z.record(z.string(), ImageInfoPage) }).optional() });

const stripHtml = (s: unknown) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || null : null);

function toPhoto(page: z.infer<typeof ImageInfoPage>, verified: boolean): Photo | null {
  const info = page.imageinfo?.[0];
  const meta = info?.extmetadata ?? {};
  const license = stripHtml(meta.LicenseShortName?.value);
  if (!info?.thumburl || !license || !FREE_LICENSE.test(license)) return null;
  if (info.mime && !/^image\/(jpeg|png|webp)$/.test(info.mime)) return null;
  return {
    url: info.thumburl, source: 'wikimedia', pageUrl: info.descriptionurl ?? null, title: page.title.replace(/^File:/, ''),
    author: stripHtml(meta.Artist?.value), license, licenseUrl: typeof meta.LicenseUrl?.value === 'string' ? meta.LicenseUrl.value : null, verified,
  };
}

async function commonsPhotos(query: Record<string, string>, verified: boolean): Promise<Photo[]> {
  const q = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: '800', ...query });
  const res = CommonsSchema.parse(await httpJson(`${COMMONS}?${q}`, { ttlMs: TTL }));
  return Object.values(res.query?.pages ?? {}).map((p) => toPhoto(p, verified)).filter((p): p is Photo => p !== null);
}

const claimValue = (claims: Record<string, z.infer<typeof Snak>> | undefined, prop: string) => claims?.[prop]?.[0]?.mainsnak.datavalue?.value;

export async function wikidata(ctx: ProviderCtx): Promise<SubResult> {
  const { wikidataId, lat, lon } = ctx.meta.resolved;
  const fields: Record<string, FactEntry> = {};
  let photos: Photo[] = [];

  if (wikidataId) {
    const url = `https://www.wikidata.org/wiki/${wikidataId}`;
    const q = new URLSearchParams({ action: 'wbgetentities', ids: wikidataId, props: 'claims', format: 'json' });
    const claims = EntitySchema.parse(await httpJson(`${WD}?${q}`, { ttlMs: TTL })).entities[wikidataId]?.claims;

    const rooms = Number(claimValue(claims, 'P8733') && (claimValue(claims, 'P8733') as { amount?: string }).amount);
    if (rooms > 0) fields.roomCount = { value: rooms, confidence: 0.8, url };

    const opened = (claimValue(claims, 'P1619') ?? claimValue(claims, 'P571')) as { time?: string } | undefined;
    const year = Number(opened?.time?.match(/^\+?(\d{4})/)?.[1]);
    if (year > 1800) fields.openingYear = { value: year, confidence: 0.8, url };

    const rating = (claimValue(claims, 'P10290') as { id?: string } | undefined)?.id;
    if (rating) {
      const lq = new URLSearchParams({ action: 'wbgetentities', ids: rating, props: 'labels', languages: 'en', format: 'json' });
      const label = EntitySchema.parse(await httpJson(`${WD}?${lq}`, { ttlMs: TTL })).entities[rating]?.labels?.en?.value;
      const stars = Number(label?.match(/(\d)/)?.[1]);
      if (stars >= 1 && stars <= 5) fields.stars = { value: stars, confidence: 0.8, url };
    }

    const image = claimValue(claims, 'P18');
    if (typeof image === 'string') photos = await commonsPhotos({ titles: `File:${image}` }, true);
  }

  // No linked image: freely licensed photos taken within a few hundred metres. Flagged as unverified.
  if (photos.length === 0) {
    photos = (await commonsPhotos({
      generator: 'geosearch', ggscoord: `${lat}|${lon}`, ggsradius: String(GEO_RADIUS_M), ggsnamespace: '6', ggslimit: '12',
    }, false)).slice(0, MAX_PHOTOS);
  }
  return { fields, photos };
}
