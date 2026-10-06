#!/usr/bin/env node
// Enriches src/data/resorts-input.json (resort names only) into src/data/resorts-enriched.json.
//
// Free sources, no key required:
//   Nominatim + Open-Meteo geocoding  -> coordinates and destination label
//   Open-Meteo archive                -> historical weather for Jan 16-23
//   OSRM + OpenFlights                -> nearest airport, transfer time, direct-flight hint
//   Wikipedia + Wikimedia Commons     -> photos, and amenities when the resort has an article
// Optional: GOOGLE_PLACES_API_KEY adds rating, review count, photos and amenity keywords.
//
// Anything the sources cannot confirm stays `null` (shown as "À confirmer" in the UI), never guessed.
// Manual corrections go in src/data/resorts-overrides.json.
//
// Usage: node scripts/fetch-resort-data.js [--force] [--offline]

import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AIRPORTS, ORIGIN } from './data/airports.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INPUT = `${ROOT}src/data/resorts-input.json`;
const OVERRIDES = `${ROOT}src/data/resorts-overrides.json`;
const OUTPUT = `${ROOT}src/data/resorts-enriched.json`;
const WEB_FACTS = `${ROOT}src/data/resorts-web.json`;
const ORIGIN_WEATHER = `${ROOT}src/data/montreal.json`;

const FORCE = process.argv.includes('--force') || process.env.FORCE_REFRESH === '1';
const WEATHER_ONLY = process.argv.includes('--weather');
const OFFLINE = process.argv.includes('--offline') || process.env.SKIP_ENRICH === '1';
const CACHE_DAYS = 14;
const TRIP_DAYS = ['01-16', '01-17', '01-18', '01-19', '01-20', '01-21', '01-22', '01-23'];
const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const UA = `vacances-famille-2027/1.0 (family resort comparison; ${process.env.CONTACT_EMAIL || 'no-contact'})`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const log = (...a) => console.log('[enrich]', ...a);
const warn = (...a) => console.warn('[enrich] ⚠', ...a);

const STOPWORDS = new Set([
  'resort', 'resorts', 'spa', 'hotel', 'hotels', 'and', 'the', 'de', 'la', 'le', 'del', 'by',
  'all', 'inclusive', 'adults', 'only', 'beach', 'club', 'suites', 'suite', 'a',
]);
// Trailing words that never name a destination ("Riu Palace Aruba Resort & Spa").
const GENERIC_SUFFIX = new Set([
  ...STOPWORDS, 'palace', 'princess', 'royal', 'deluxe', 'premium', 'grand', 'plaza', 'collection', 'family', 'wellness',
]);

const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((t) => t && !STOPWORDS.has(t));

function slugify(name) {
  const words = norm(name)
    .replace(/&/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !['resort', 'spa', 'and'].includes(w));
  return words.join('-') || 'resort';
}

function haversine(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}

// "1 h 25" style, for the sentences shown to the family.
function frDuration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

function deepMerge(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = { ...(target && typeof target === 'object' && !Array.isArray(target) ? target : {}) };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out;
}

async function http(url, { method = 'GET', headers = {}, body, retries = 3, timeout = 25000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { 'user-agent': UA, accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${url.split('?')[0]}`);
        err.fatal = true;
        throw err;
      }
      return res;
    } catch (err) {
      if (err.fatal || attempt >= retries) throw err;
      await sleep(1500 * 2 ** attempt);
    }
  }
}
const getJson = async (url, opts) => (await http(url, opts)).json();

// Nominatim allows 1 request per second.
let lastNominatim = 0;
async function nominatim(path, params) {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastNominatim = Date.now();
  const qs = new URLSearchParams({ format: 'jsonv2', 'accept-language': 'fr', ...params });
  return getJson(`https://nominatim.openstreetmap.org/${path}?${qs}`);
}

// ---------------------------------------------------------------------------
// 1. Geocoding
// ---------------------------------------------------------------------------

// Destination named at the end of the resort name: "Riu Palace Aruba" -> Aruba.
async function destinationFromName(name) {
  let words = name.replace(/[&,]/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length > 1 && GENERIC_SUFFIX.has(norm(words[words.length - 1]))) words.pop();
  for (let k = Math.min(4, words.length); k >= 1; k--) {
    const phrase = words.slice(-k).join(' ');
    let data;
    try {
      data = await getJson(
        `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: phrase, count: '5', language: 'fr' })}`,
      );
    } catch {
      continue;
    }
    for (const r of data.results ?? []) {
      const code = r.feature_code ?? '';
      const small = (r.population ?? 0) < 1_500_000; // "Mexico" must not resolve to Mexico City
      const place = (code.startsWith('PPL') && code !== 'PPLC') || code.startsWith('ISL') || code.startsWith('PCL');
      if (place && small) {
        return { lat: r.latitude, lon: r.longitude, label: `${r.name}, ${r.country ?? ''}`.replace(/, $/, ''), phrase };
      }
    }
  }
  return null;
}

async function geocodeResort(name, places) {
  if (places?.location) {
    return { lat: places.location.latitude, lon: places.location.longitude, precision: 'exact', source: 'Google Places' };
  }
  const cleaned = name.replace(/\b(resort|spa|all inclusive|adults only)\b/gi, ' ').replace(/[&]/g, ' ').replace(/\s+/g, ' ').trim();
  const isLodging = (r) => r.category === 'tourism' || (r.category === 'leisure' && r.type === 'resort');
  for (const q of new Set([name, cleaned, `${cleaned} hotel`])) {
    try {
      const results = await nominatim('search', { q, limit: '5', addressdetails: '1' });
      const hit = results.find(isLodging);
      if (hit) {
        return { lat: Number(hit.lat), lon: Number(hit.lon), precision: 'exact', source: 'OpenStreetMap Nominatim', address: hit.address };
      }
    } catch (err) {
      warn(`Nominatim: ${err.message}`);
    }
  }
  return null;
}

async function reverseLabel(lat, lon) {
  try {
    const r = await nominatim('reverse', { lat: String(lat), lon: String(lon), zoom: '10', addressdetails: '1' });
    const a = r.address ?? {};
    const place = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state;
    return [place, a.country].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. Google Places (optional)
// ---------------------------------------------------------------------------

async function googlePlaces(name) {
  if (!PLACES_KEY) return null;
  try {
    const data = await getJson('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': PLACES_KEY,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.photos,places.editorialSummary,places.reviews,places.websiteUri',
      },
      body: JSON.stringify({ textQuery: name, languageCode: 'fr', maxResultCount: 1 }),
    });
    const place = data.places?.[0];
    if (!place) return null;
    // skipHttpRedirect returns a key-free photo URL, so the key never ends up in the static site.
    const photos = [];
    for (const p of (place.photos ?? []).slice(0, 5)) {
      try {
        const m = await getJson(`https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=1400&skipHttpRedirect=true&key=${PLACES_KEY}`);
        if (m.photoUri) photos.push({ url: m.photoUri, credit: p.authorAttributions?.[0]?.displayName ?? 'Google Maps', source: 'Google Places' });
      } catch {
        /* skip this photo */
      }
    }
    place.photoList = photos;
    return place;
  } catch (err) {
    warn(`Google Places: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. Wikipedia / Commons: article text, images
// ---------------------------------------------------------------------------

async function wikipedia(name) {
  const want = tokens(name);
  let best = null;
  for (const lang of ['fr', 'en']) {
    try {
      const api = `https://${lang}.wikipedia.org/w/api.php`;
      const search = await getJson(`${api}?${new URLSearchParams({ action: 'query', format: 'json', list: 'search', srsearch: name, srlimit: '3' })}`);
      for (const hit of search.query?.search ?? []) {
        const have = new Set(tokens(hit.title));
        const score = want.filter((t) => have.has(t)).length / Math.max(want.length, 1);
        if (score >= 0.6 && (!best || score > best.score)) best = { lang, title: hit.title, score };
      }
      if (best) break;
    } catch (err) {
      warn(`Wikipedia (${lang}): ${err.message}`);
    }
  }
  if (!best) return null;
  const api = `https://${best.lang}.wikipedia.org/w/api.php`;
  const data = await getJson(
    `${api}?${new URLSearchParams({
      action: 'query', format: 'json', titles: best.title, prop: 'extracts|pageimages|coordinates',
      explaintext: '1', exchars: '9000', piprop: 'thumbnail', pithumbsize: '1400',
    })}`,
  );
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined) return null;
  return {
    title: page.title,
    url: `https://${best.lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    extract: page.extract ?? '',
    thumb: page.thumbnail?.source ?? null,
    coords: page.coordinates?.[0] ? { lat: page.coordinates[0].lat, lon: page.coordinates[0].lon } : null,
  };
}

async function commonsImages(query, { mustMatch = [], phrase = null, limit = 5 } = {}) {
  await sleep(1000); // Commons rate-limits aggressively
  try {
    const data = await getJson(
      `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
        action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '20',
        gsrsearch: `${query} filetype:bitmap`, prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '1400',
      })}`,
    );
    const out = [];
    const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index);
    for (const p of pages) {
      const info = p.imageinfo?.[0];
      if (!info || info.mime !== 'image/jpeg' || info.width < 900) continue;
      const hay = norm(`${p.title} ${info.extmetadata?.ImageDescription?.value ?? ''}`).replace(/[^a-z0-9]+/g, ' ');
      if (mustMatch.length && !mustMatch.every((t) => hay.includes(t))) continue;
      if (phrase && !hay.includes(phrase)) continue; // "Playa del Carmen" must not match "Ciudad del Carmen"

      const artist = (info.extmetadata?.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim();
      const license = info.extmetadata?.LicenseShortName?.value ?? '';
      out.push({
        url: info.thumburl ?? info.url,
        credit: [artist, license, 'Wikimedia Commons'].filter(Boolean).join(' · '),
        source: 'Wikimedia Commons',
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    warn(`Commons: ${err.message}`);
    return [];
  }
}

async function destinationImage(label) {
  const place = label?.split(',')[0]?.trim();
  if (!place) return [];
  const out = [];
  for (const lang of ['fr', 'en']) {
    try {
      const d = await getJson(
        `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({
          action: 'query', format: 'json', titles: place, redirects: '1', prop: 'pageimages|pageprops', piprop: 'thumbnail', pithumbsize: '1400',
        })}`,
      );
      const page = Object.values(d.query?.pages ?? {})[0];
      if (page?.thumbnail?.source && page.pageprops?.disambiguation === undefined) {
        out.push({ url: page.thumbnail.source, credit: `Wikipédia : ${page.title}`, source: 'Wikipedia' });
        break;
      }
    } catch (err) {
      warn(`Wikipedia image (${lang}): ${err.message}`);
    }
  }
  const phrase = norm(place).replace(/[^a-z0-9]+/g, ' ').trim();
  out.push(...(await commonsImages(`${place} beach`, { phrase, limit: 2 })));
  return out;
}

// ---------------------------------------------------------------------------
// 4. Amenities from text (true only when the text says so; absence proves nothing)
// ---------------------------------------------------------------------------

function extractAmenities(corpora) {
  const a = {
    qualitePlage: null, nombrePiscines: null, clubEnfants: null, parcAquatique: null, nombreRestaurants: null,
    nombreBars: null, qualiteWifi: null, spaSurPlace: null, serviceChambre24h: null,
  };
  const flags = [
    ['parcAquatique', /parc aquatique|water ?park|aqua ?park|aquapark|toboggans?|water ?slides?/i],
    ['clubEnfants', /club (pour )?enfants|kids'? club|children'?s club|mini[- ]?club|club des enfants/i],
    ['spaSurPlace', /\bspa\b/i],
    ['serviceChambre24h', /room service|service (aux|en) chambres?|service d'étage/i],
  ];
  const counts = [
    ['nombreRestaurants', /(\d{1,2})\s+(?:à la carte\s+|a la carte\s+)?restaurants?/i],
    ['nombreBars', /(\d{1,2})\s+bars?\b/i],
    ['nombrePiscines', /(\d{1,2})\s+(?:swimming\s+|outdoor\s+)?(?:pools?|piscines?)/i],
  ];
  for (const { text, counts: allowCounts } of corpora) {
    if (!text) continue;
    for (const [key, re] of flags) if (re.test(text)) a[key] = true;
    if (!allowCounts) continue;
    for (const [key, re] of counts) {
      const m = text.match(re);
      if (m && a[key] === null) a[key] = Number(m[1]);
    }
  }
  return a;
}

// ---------------------------------------------------------------------------
// 5. Weather (Open-Meteo archive, same dates over the last 5 Januaries)
// ---------------------------------------------------------------------------

async function historicalWeather({ lat, lon }) {
  const now = new Date();
  const lastYear = now > new Date(now.getFullYear(), 0, 25) ? now.getFullYear() : now.getFullYear() - 1;
  const years = Array.from({ length: 5 }, (_, i) => lastYear - 4 + i);
  const perDay = TRIP_DAYS.map(() => ({ max: [], min: [], rain: [], mm: [], cloud: [], sun: [] }));
  const parAnnee = []; // every past year, day by day: lets the site show the spread, not just the average

  for (const y of years) {
    try {
      const d = await getJson(
        `https://archive-api.open-meteo.com/v1/archive?${new URLSearchParams({
          latitude: String(lat), longitude: String(lon), start_date: `${y}-01-16`, end_date: `${y}-01-23`,
          daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,cloud_cover_mean,daylight_duration', timezone: 'auto',
        })}`,
      );
      const day = d.daily;
      parAnnee.push({
        annee: y,
        jours: day.time.map((_, i) => ({
          tempMaxC: day.temperature_2m_max[i] == null ? null : round(day.temperature_2m_max[i], 1),
          tempMinC: day.temperature_2m_min[i] == null ? null : round(day.temperature_2m_min[i], 1),
          precipMm: day.precipitation_sum[i] == null ? null : round(day.precipitation_sum[i], 1),
          nuagesPct: day.cloud_cover_mean?.[i] == null ? null : round(day.cloud_cover_mean[i]),
        })),
      });
      day.time.forEach((_, i) => {
        if (day.temperature_2m_max[i] != null) perDay[i].max.push(day.temperature_2m_max[i]);
        if (day.temperature_2m_min[i] != null) perDay[i].min.push(day.temperature_2m_min[i]);
        if (day.precipitation_sum[i] != null) {
          perDay[i].rain.push(day.precipitation_sum[i] >= 1 ? 1 : 0);
          perDay[i].mm.push(day.precipitation_sum[i]);
        }
        if (day.cloud_cover_mean?.[i] != null) {
          perDay[i].cloud.push(day.cloud_cover_mean[i]);
          // The archive's own sunshine_duration ignores clouds in the tropics, so estimate from cloud cover.
          if (day.daylight_duration?.[i] != null) perDay[i].sun.push((day.daylight_duration[i] / 3600) * (1 - day.cloud_cover_mean[i] / 100));
        }
      });
    } catch (err) {
      warn(`Open-Meteo ${y}: ${err.message}`);
    }
    await sleep(250);
  }

  const parJour = TRIP_DAYS.map((date, i) => ({
    date,
    tempMaxC: perDay[i].max.length ? round(mean(perDay[i].max), 1) : null,
    tempMaxBasC: perDay[i].max.length ? round(Math.min(...perDay[i].max), 1) : null,
    tempMaxHautC: perDay[i].max.length ? round(Math.max(...perDay[i].max), 1) : null,
    tempMinC: perDay[i].min.length ? round(mean(perDay[i].min), 1) : null,
    tempMinBasC: perDay[i].min.length ? round(Math.min(...perDay[i].min), 1) : null,
    tempMinHautC: perDay[i].min.length ? round(Math.max(...perDay[i].min), 1) : null,
    precipMm: perDay[i].mm.length ? round(mean(perDay[i].mm), 1) : null,
    probabilitePluiePct: perDay[i].rain.length ? round(mean(perDay[i].rain) * 100) : null,
    couvertureNuageusePct: perDay[i].cloud.length ? round(mean(perDay[i].cloud)) : null,
    heuresSoleil: perDay[i].sun.length ? round(mean(perDay[i].sun), 1) : null,
  }));
  const avg = (key) => {
    const v = parJour.map((d) => d[key]).filter((x) => x != null);
    return v.length ? mean(v) : null;
  };
  if (avg('tempMaxC') === null) throw new Error('Aucune donnée météo');
  return {
    tempMaxC: round(avg('tempMaxC')),
    tempMinC: round(avg('tempMinC')),
    probabilitePluiePct: avg('probabilitePluiePct') === null ? null : round(avg('probabilitePluiePct')),
    heuresSoleilParJour: avg('heuresSoleil') === null ? null : round(avg('heuresSoleil'), 1),
    couvertureNuageusePct: avg('couvertureNuageusePct') === null ? null : round(avg('couvertureNuageusePct')),
    annees: years,
    parJour,
    parAnnee,
  };
}

// ---------------------------------------------------------------------------
// 6. Travel: nearest airport, flight estimate, ground transfer
// ---------------------------------------------------------------------------

let directRoutes = null; // Set of airport codes with a YUL non-stop in OpenFlights (historical data)
async function loadDirectRoutes() {
  if (directRoutes) return directRoutes;
  directRoutes = new Set();
  try {
    const res = await http('https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat', { headers: { accept: 'text/plain' } });
    for (const line of (await res.text()).split('\n')) {
      const f = line.split(',');
      if (f[2] === 'YUL' && f[7] === '0') directRoutes.add(f[4]);
    }
  } catch (err) {
    warn(`OpenFlights: ${err.message}`);
    directRoutes = null;
  }
  return directRoutes;
}

async function planTravel(coords, forcedCode) {
  const ranked = AIRPORTS.map((a) => ({ ...a, straight: haversine(a, coords) })).sort((x, y) => x.straight - y.straight);
  const near = forcedCode ? ranked.filter((a) => a.code === forcedCode) : ranked.filter((a) => a.straight <= 250).slice(0, 4);
  if (!near.length) throw new Error(`Aucun aéroport à moins de 250 km${forcedCode ? ` (code ${forcedCode} inconnu)` : ''}`);

  // Driving time from each candidate airport; unreachable (island) candidates drop out.
  let best = null;
  try {
    const pts = [coords, ...near].map((p) => `${p.lon},${p.lat}`).join(';');
    const sources = near.map((_, i) => i + 1).join(';');
    const d = await getJson(`https://router.project-osrm.org/table/v1/driving/${pts}?sources=${sources}&destinations=0&annotations=duration,distance`);
    near.forEach((a, i) => {
      const sec = d.durations?.[i]?.[0];
      const m = d.distances?.[i]?.[0];
      if (sec != null && (!best || sec < best.sec)) best = { airport: a, sec, km: m / 1000, estimated: false };
    });
  } catch (err) {
    warn(`OSRM: ${err.message}`);
  }
  if (!best) {
    const a = near[0];
    const km = a.straight * 1.4;
    best = { airport: a, sec: (km / 50) * 3600, km, estimated: true };
  }

  const airport = best.airport;
  const transferMin = Math.max(5, Math.round(best.sec / 60 / 5) * 5);
  const distKm = haversine(ORIGIN, airport);
  const flightMin = Math.round((distKm / 800) * 60 + 25);
  const flightRounded = Math.round(flightMin / 5) * 5;

  const routes = await loadDirectRoutes();
  const volDirect = routes ? routes.has(airport.code) : null;
  const volLabel = volDirect === true ? 'Vol direct, à confirmer' : volDirect === false ? 'Direct non répertorié, escale possible' : 'À confirmer';

  return {
    aeroportDepart: ORIGIN.label,
    aeroportArrivee: `${airport.code} (${airport.ville})`,
    dureeVol: `${formatDuration(flightRounded)} (${volLabel})`,
    dureeVolMinutes: flightRounded,
    distanceVolKm: round(distKm, -1),
    volDirect,
    tempsTransfertResort: `${transferMin} min (${best.estimated ? 'estimation à vol d’oiseau' : 'route'})`,
    tempsTransfertMinutes: transferMin,
    distanceTransfertKm: round(best.km),
    tempsTrajetTotalMinutes: flightRounded + transferMin,
    estimationVol: true,
  };
}

// ---------------------------------------------------------------------------
// 7. Pros / cons derived only from the collected data
// ---------------------------------------------------------------------------

function deriveProsCons({ meteo, transport, infra, rating, ratingCount }) {
  const pros = [];
  const cons = [];
  if (rating >= 4.5) pros.push(`Très bien noté : ${rating}/5 (${ratingCount ?? '?'} avis)`);
  else if (rating !== null && rating < 4) cons.push(`Note moyenne : ${rating}/5`);

  if (meteo) {
    if (meteo.tempMaxC >= 27 && meteo.probabilitePluiePct <= 20) pros.push(`Chaud et plutôt sec en janvier : ${meteo.tempMaxC} °C, de la pluie ${meteo.probabilitePluiePct} % des jours`);
    else if (meteo.tempMaxC >= 25) pros.push(`Chaud en janvier : de ${meteo.tempMinC} à ${meteo.tempMaxC} °C`);
    else cons.push(`Plus frais en janvier : ${meteo.tempMaxC} °C au maximum`);
    if (meteo.couvertureNuageusePct !== null && meteo.couvertureNuageusePct <= 30) pros.push(`Ciel souvent dégagé (${meteo.couvertureNuageusePct} % de nuages en moyenne)`);
    if (meteo.probabilitePluiePct >= 35) cons.push(`Pluie fréquente en janvier : ${meteo.probabilitePluiePct} % des jours`);
  }
  if (transport) {
    if (transport.volDirect === true) pros.push('Vol sans escale possible depuis Montréal (à confirmer)');
    if (transport.volDirect === false) cons.push('Aucun vol sans escale répertorié depuis Montréal (à confirmer)');
    if (transport.dureeVolMinutes <= 270) pros.push(`Vol court : environ ${frDuration(transport.dureeVolMinutes)}`);
    if (transport.dureeVolMinutes > 330) cons.push(`Vol assez long : environ ${frDuration(transport.dureeVolMinutes)}`);
    if (transport.tempsTransfertMinutes <= 30) pros.push(`Route courte depuis l’aéroport : ${frDuration(transport.tempsTransfertMinutes)}`);
    if (transport.tempsTransfertMinutes > 60) cons.push(`Route longue depuis l’aéroport : ${frDuration(transport.tempsTransfertMinutes)}`);
  }
  if (infra.parcAquatique) pros.push('Parc aquatique sur place');
  if (infra.clubEnfants) pros.push('Club pour enfants');
  if (infra.nombreRestaurants >= 8) pros.push(`${infra.nombreRestaurants} restaurants`);
  if (infra.serviceChambre24h) pros.push('Service aux chambres 24 h');
  return { pointsForts: pros.slice(0, 6), pointsFaibles: cons.slice(0, 6) };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function enrichResort(name, id, { forcedAirport } = {}) {
  const warnings = [];
  const sources = new Set();

  const places = await googlePlaces(name);
  if (places) sources.add('Google Places');
  const wiki = await wikipedia(name).catch((e) => (warn(`Wikipedia: ${e.message}`), null));
  if (wiki) sources.add('Wikipedia');
  const destGuess = await destinationFromName(name);

  let geo = await geocodeResort(name, places);
  if (!geo && wiki?.coords) geo = { ...wiki.coords, precision: 'exact', source: 'Wikipedia' };
  if (!geo && destGuess) {
    geo = { lat: destGuess.lat, lon: destGuess.lon, precision: 'destination', source: 'Open-Meteo Geocoding' };
    warnings.push('Position exacte introuvable : coordonnées de la destination utilisées (météo et transfert approximatifs).');
  }
  if (!geo) throw new Error('Impossible de géolocaliser ce resort');
  sources.add(geo.source);

  let destination = destGuess && haversine(destGuess, geo) < 80 ? destGuess.label : await reverseLabel(geo.lat, geo.lon);
  destination = destination ?? destGuess?.label ?? null;

  const [meteo, transport] = await Promise.all([
    historicalWeather(geo).catch((e) => (warnings.push(`Météo indisponible : ${e.message}`), null)),
    planTravel(geo, forcedAirport).catch((e) => (warnings.push(`Transport indisponible : ${e.message}`), null)),
  ]);
  if (meteo) sources.add('Open-Meteo');
  if (transport) ['OSRM', 'OpenFlights (historique)'].forEach((s) => sources.add(s));

  // Images: Places > Wikipedia > Commons (resort-specific) > destination illustration.
  const gallery = [...(places?.photoList ?? [])];
  if (wiki?.thumb) gallery.push({ url: wiki.thumb, credit: `Wikipédia : ${wiki.title}`, source: 'Wikipedia' });
  if (gallery.length < 3) {
    const sig = tokens(name).slice(0, 3);
    gallery.push(...(await commonsImages(`${name}`, { mustMatch: sig.length > 1 ? sig.slice(0, 2) : sig, limit: 4 })));
  }
  let genericImage = false;
  if (!gallery.length) {
    gallery.push(...(await destinationImage(destination)));
    genericImage = gallery.length > 0;
    if (genericImage) warnings.push('Aucune photo du resort trouvée : photos d’illustration de la destination.');
  }
  if (gallery.length) sources.add(gallery[0].source);
  const seen = new Set();
  const galerie = gallery.filter((g) => !seen.has(g.url) && seen.add(g.url)).slice(0, 6);

  const corpora = [
    { text: wiki?.extract, counts: true },
    { text: places?.editorialSummary?.text, counts: true },
    { text: (places?.reviews ?? []).map((r) => r.text?.text ?? '').join('\n'), counts: false },
  ];
  const infra = extractAmenities(corpora);
  if (Object.values(infra).every((v) => v === null)) warnings.push('Aucune infrastructure confirmée automatiquement : à compléter dans resorts-overrides.json.');

  const rating = places?.rating ?? null;
  const { pointsForts, pointsFaibles } = deriveProsCons({ meteo, transport, infra, rating, ratingCount: places?.userRatingCount });

  return {
    id,
    nom: name,
    destination,
    image: galerie[0]?.url ?? null,
    imageGenerique: genericImage,
    galerie,
    noteGenerale: rating,
    nombreAvis: places?.userRatingCount ?? null,
    siteOfficiel: places?.websiteUri ?? null,
    lienWikipedia: wiki?.url ?? null,
    pointsForts,
    pointsFaibles,
    logistiqueTransport: transport,
    meteoHistoriqueJanvier16: meteo
      ? {
          tempMaxC: meteo.tempMaxC,
          tempMinC: meteo.tempMinC,
          probabilitePluiePct: meteo.probabilitePluiePct,
          heuresSoleilParJour: meteo.heuresSoleilParJour,
          couvertureNuageusePct: meteo.couvertureNuageusePct,
          annees: meteo.annees,
          parJour: meteo.parJour,
          parAnnee: meteo.parAnnee,
        }
      : null,
    infrastructures: infra,
    coordonnees: { lat: round(geo.lat, 5), lon: round(geo.lon, 5), precision: geo.precision },
    meta: {
      enrichedAt: new Date().toISOString(),
      sources: [...sources],
      avertissements: warnings,
      aeroportForce: forcedAirport ?? null,
      champsManuels: [],
    },
  };
}

function stubEntry(name, id, reason) {
  return {
    id, nom: name, destination: null, image: null, imageGenerique: false, galerie: [], noteGenerale: null, nombreAvis: null,
    siteOfficiel: null, lienWikipedia: null, lienTripadvisor: null, etoiles: null, pointsForts: [], pointsFaibles: [], logistiqueTransport: null,
    meteoHistoriqueJanvier16: null,
    infrastructures: {
      qualitePlage: null, nombrePiscines: null, clubEnfants: null, parcAquatique: null, nombreRestaurants: null,
      nombreBars: null, qualiteWifi: null, spaSurPlace: null, serviceChambre24h: null,
    },
    coordonnees: null,
    meta: { enrichedAt: new Date().toISOString(), sources: [], avertissements: [reason], aeroportForce: null, champsManuels: [] },
  };
}

// Facts found by `npm run enrich:web`: fill empty fields only, and remember where each one came from.
// Fields filled by an earlier run are cleared first, so removing a fact from resorts-web.json takes effect.
function wifiInFrench(v) {
  const t = String(v);
  if (/free|gratuit|gratis|complimentary/i.test(t)) return 'gratuit';
  if (/fee|paid|payant|de pago/i.test(t)) return 'payant';
  return t;
}

const TOP_LEVEL = ['noteGenerale', 'nombreAvis', 'etoiles', 'siteOfficiel', 'lienTripadvisor'];

function applyWeb(entry, web) {
  for (const field of Object.keys(entry.meta?.champsIA ?? {})) {
    if (field in (entry.infrastructures ?? {})) entry.infrastructures[field] = null;
    else if (TOP_LEVEL.includes(field)) entry[field] = null;
  }
  const filled = {};
  const note = (field, fact) => {
    filled[field] = { url: fact.url, quote: fact.quote, model: web.model ?? null, date: web.generatedAt ?? null, methode: fact.methode ?? 'ia' };
  };
  for (const [field, fact] of Object.entries(web?.facts ?? {})) {
    if (entry.infrastructures && field in entry.infrastructures && entry.infrastructures[field] == null) {
      entry.infrastructures[field] = field === 'qualiteWifi' ? wifiInFrench(fact.value) : fact.value;
      note(field, fact);
    }
  }
  for (const [field, fact] of Object.entries(web?.extras ?? {})) {
    if (TOP_LEVEL.includes(field) && entry[field] == null) {
      entry[field] = fact.value;
      note(field, fact);
    }
  }
  entry.meta = { ...entry.meta, champsIA: filled, sourceOfficielle: Boolean(web?.officiel) };
  return entry;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const input = await readJson(INPUT, null);
  if (!Array.isArray(input) || !input.every((n) => typeof n === 'string' && n.trim())) {
    console.error('[enrich] src/data/resorts-input.json doit être un tableau de noms de resorts (chaînes non vides).');
    process.exit(1);
  }
  const names = [...new Set(input.map((n) => n.trim()))];
  const previous = await readJson(OUTPUT, []);
  const overrides = await readJson(OVERRIDES, {});
  const webFacts = await readJson(WEB_FACTS, {});

  if (!OFFLINE && (WEATHER_ONLY || FORCE || !(await readJson(ORIGIN_WEATHER, null)))) await refreshOriginWeather();

  if (WEATHER_ONLY) {
    // Refresh only the weather of the resorts we already know (uses their saved coordinates).
    for (const entry of previous) {
      if (!entry.coordonnees) continue;
      log(`${entry.nom} : météo…`);
      try {
        const meteo = await historicalWeather(entry.coordonnees);
        entry.meteoHistoriqueJanvier16 = {
          tempMaxC: meteo.tempMaxC, tempMinC: meteo.tempMinC, probabilitePluiePct: meteo.probabilitePluiePct,
          heuresSoleilParJour: meteo.heuresSoleilParJour, couvertureNuageusePct: meteo.couvertureNuageusePct,
          annees: meteo.annees, parJour: meteo.parJour, parAnnee: meteo.parAnnee,
        };
        const { pointsForts, pointsFaibles } = deriveProsCons({ meteo, transport: entry.logistiqueTransport, infra: entry.infrastructures, rating: entry.noteGenerale, ratingCount: entry.nombreAvis });
        entry.pointsForts = pointsForts;
        entry.pointsFaibles = pointsFaibles;
      } catch (err) {
        warn(`${entry.nom} : ${err.message}`);
      }
    }
    await writeFile(OUTPUT, `${JSON.stringify(previous, null, 2)}\n`);
    log(`Météo mise à jour pour ${previous.length} resort(s).`);
    return;
  }

  const ids = new Set();
  const results = [];
  for (const name of names) {
    let id = slugify(name);
    for (let n = 2; ids.has(id); n++) id = `${slugify(name)}-${n}`;
    ids.add(id);

    const override = overrides[id] ?? overrides[name] ?? {};
    const { aeroport: forcedAirport = null, ...patch } = override;
    const cached = previous.find((e) => e.nom === name);
    const ageDays = cached ? (Date.now() - new Date(cached.meta?.enrichedAt ?? 0)) / 864e5 : Infinity;
    const usable = cached && cached.id === id && ageDays < CACHE_DAYS && (cached.meta?.aeroportForce ?? null) === forcedAirport;

    let entry;
    if (OFFLINE || (usable && !FORCE)) {
      entry = cached ?? stubEntry(name, id, 'Mode hors ligne : aucune donnée en cache.');
      log(`${name}: ${OFFLINE ? 'hors ligne' : 'cache'} (${cached ? Math.round(ageDays) + ' j' : 'vide'})`);
    } else {
      log(`${name}: enrichissement…`);
      try {
        entry = await enrichResort(name, id, { forcedAirport });
      } catch (err) {
        warn(`${name}: ${err.message}`);
        entry = cached ? { ...cached, id } : stubEntry(name, id, err.message);
      }
    }
    entry = applyWeb(entry, webFacts[id]);
    if (Object.keys(patch).length) {
      entry = deepMerge(entry, patch);
      for (const field of Object.keys(patch.infrastructures ?? {})) delete entry.meta.champsIA?.[field]; // your correction wins
      entry.meta = { ...entry.meta, champsManuels: Object.keys(patch) };
    }
    results.push(entry);
  }

  await writeFile(OUTPUT, `${JSON.stringify(results, null, 2)}\n`);
  const incomplete = results.filter((r) => r.meta.avertissements.length).length;
  log(`${results.length} resort(s) écrits dans resorts-enriched.json${incomplete ? ` (${incomplete} avec avertissements)` : ''}.`);
}

main().catch((err) => {
  console.error('[enrich] Échec :', err);
  process.exit(1);
});
