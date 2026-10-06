#!/usr/bin/env node
// Fills "À confirmer" fields automatically from each resort's own web pages.
//
//   npm run enrich:web                    every resort that still has gaps
//   npm run enrich:web -- --only riu-playacar --force
//   npm run enrich:web -- --rules-only    no AI: only what the pages state in structured form
//   npm run enrich:web -- --dry           show which pages would be read, and what the rules find
//
// Two layers, cheapest and most reliable first:
//   1. Rules. The official page's own structured data: schema.org JSON-LD (amenity list, ratings), the site's
//      embedded app state (TripAdvisor rating and review count it displays, star category), counts written in
//      the text ("10 different restaurants") and the number of cards on the gastronomy page.
//   2. A local model (Ollama) for what the rules did not find, in free text. Every fact needs an exact quote
//      that the script checks against the page. Facts that fail the check are thrown away.
// Only "yes" answers and explicit numbers are kept: a page that does not mention a water park proves nothing.
// robots.txt is respected, one resort at a time, a handful of pages each.
//
// Results go to src/data/resorts-web.json. `npm run enrich` merges them into the site (never over your own
// corrections in resorts-overrides.json). The site says whether a value was read by a rule or found by the AI.
//
// AI setup (optional): install Ollama, then `ollama pull qwen3:8b`. Env: OLLAMA_HOST, OLLAMA_MODEL.

import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENRICHED = `${ROOT}src/data/resorts-enriched.json`;
const SOURCES = `${ROOT}src/data/resorts-sources.json`;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);

const OUTPUT = option('out') ?? `${ROOT}src/data/resorts-web.json`;
const OLLAMA = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const MODEL = option('model') ?? process.env.OLLAMA_MODEL ?? 'qwen3:8b';
const DRY = flag('dry');
const RULES_ONLY = flag('rules-only') || flag('no-ai');
const FORCE = flag('force');
const ONLY = option('only');

const BOT_UA = `Mozilla/5.0 (compatible; vacances-famille-2027; ${process.env.CONTACT_EMAIL || 'personal use'})`;
const MAX_PAGES = 3;
const MAX_CHARS = 10_000; // text sent to the model per page

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[web]', ...a);
const warn = (...a) => console.warn('[web] ⚠', ...a);
const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const flat = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
const STOPWORDS = new Set(['resort', 'resorts', 'spa', 'hotel', 'hotels', 'and', 'the', 'de', 'la', 'le', 'del', 'by', 'all', 'inclusive', 'adults', 'only', 'beach', 'club', 'suites', 'suite', 'a']);
const tokens = (s) => flat(s).split(' ').filter((t) => t && !STOPWORDS.has(t));

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// What we ask for. `must` is a sanity check on the quote: it has to talk about the right thing.
// ---------------------------------------------------------------------------

const FIELDS = {
  clubEnfants: { type: 'boolean', ask: 'there is a kids club / children\'s club / mini club', must: /kids|child|enfant|nino|junior|mini ?club|teen|pequen|riu land|little ones/ },
  parcAquatique: { type: 'boolean', ask: 'there is a water park / aquatic park / water slides', must: /water ?park|aqua|toboggan|slide|splash/ },
  spaSurPlace: { type: 'boolean', ask: 'there is an on-site spa', must: /\bspa\b|wellness|massage/ },
  serviceChambre24h: { type: 'boolean', ask: 'there is 24-hour room service', must: /room service|service (a|aux) chambre|servicio de habitacion/ },
  nombrePiscines: { type: 'integer', ask: 'the number of swimming pools', must: /pool|piscin|alberca/ },
  nombreRestaurants: { type: 'integer', ask: 'the number of restaurants', must: /restaurant|buffet|a la carte|grill/ },
  nombreBars: { type: 'integer', ask: 'the number of bars', must: /\bbars?\b|lounge|pub\b/ },
  qualiteWifi: { type: 'string', enum: ['gratuit', 'payant'], ask: 'Wi-Fi: "gratuit" if the text says it is free, "payant" if it says it is paid', must: /wi ?fi|wifi|internet/ },
  qualitePlage: { type: 'string', translate: true, ask: 'the beach: sand, water, location (short phrase in French, 12 words max)', must: /beach|plage|playa|sand|sable|arena/ },
};

const NUMBER_WORDS = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'],
  fr: ['zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze'],
  es: ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce'],
};

function quoteSupportsNumber(quote, n) {
  const q = flat(quote);
  if (new RegExp(`(^| )${n}( |$)`).test(q)) return true;
  return Object.values(NUMBER_WORDS).some((words) => words[n] && new RegExp(`(^| )${words[n]}( |$)`).test(q));
}

/** Returns { ok: true, value } or { ok: false, reason }. */
function verify(field, fact, pageText) {
  const spec = FIELDS[field];
  if (!fact?.found) return { ok: false, reason: 'non trouvé' };
  const quote = String(fact.quote ?? '').trim();
  const normQuote = flat(quote);
  if (normQuote.length < 8) return { ok: false, reason: 'citation trop courte ou absente' };
  if (!flat(pageText).includes(normQuote)) return { ok: false, reason: 'citation introuvable dans la page' };
  if (!spec.must.test(flat(quote))) return { ok: false, reason: 'la citation ne parle pas du bon sujet' };

  if (spec.type === 'boolean') return fact.value === true ? { ok: true, value: true, quote } : { ok: false, reason: 'absence non prouvée' };
  if (spec.type === 'integer') {
    const n = Number(fact.value);
    if (!Number.isInteger(n) || n < 1 || n > 99) return { ok: false, reason: 'nombre invalide' };
    return quoteSupportsNumber(quote, n) ? { ok: true, value: n, quote } : { ok: false, reason: 'le nombre n’apparaît pas dans la citation' };
  }
  const text = String(fact.value ?? '').trim();
  if (spec.enum && !spec.enum.includes(text)) return { ok: false, reason: 'valeur hors choix' };
  return text && text.length <= 100 ? { ok: true, value: text, quote } : { ok: false, reason: 'texte vide ou trop long' };
}

// ---------------------------------------------------------------------------
// Finding and reading pages
// ---------------------------------------------------------------------------

async function fetchText(url, { timeout = 30_000, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } = {}) {
  const res = await fetch(url, { headers: { 'user-agent': BOT_UA, accept, 'accept-language': 'en,fr;q=0.8' }, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const robotsCache = new Map();
/** Minimal robots.txt check for the "*" group. If robots.txt cannot be read, we allow. */
async function allowedByRobots(url) {
  const { origin, pathname, search } = new URL(url);
  if (!robotsCache.has(origin)) {
    const rules = [];
    try {
      let inStar = false;
      let sawRule = false;
      for (const raw of (await fetchText(`${origin}/robots.txt`, { timeout: 15_000, accept: 'text/plain' })).split('\n')) {
        const line = raw.replace(/#.*/, '').trim();
        const [k, ...rest] = line.split(':');
        const v = rest.join(':').trim();
        if (/^user-agent$/i.test(k)) {
          if (sawRule) inStar = false;
          if (v === '*') inStar = true;
          sawRule = false;
        } else if (inStar && /^(allow|disallow)$/i.test(k) && v) {
          sawRule = true;
          rules.push({ allow: /^allow$/i.test(k), pattern: v });
        }
      }
    } catch {
      /* no robots.txt: allowed */
    }
    robotsCache.set(origin, rules);
  }
  const target = pathname + search;
  const matches = (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`).test(target);
  let best = null;
  for (const r of robotsCache.get(origin)) if (matches(r.pattern) && (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow))) best = r;
  return !best || best.allow;
}

let lastNominatim = 0;
async function osmWebsite(name) {
  const cleaned = name.replace(/\b(resort|spa|all inclusive|adults only)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  for (const q of new Set([`${cleaned} hotel`, name])) {
    const wait = lastNominatim + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastNominatim = Date.now();
    try {
      const qs = new URLSearchParams({ q, format: 'jsonv2', limit: '5', extratags: '1' });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, { headers: { 'user-agent': BOT_UA }, signal: AbortSignal.timeout(20_000) });
      const hits = await res.json();
      const hit = hits.find((h) => (h.category === 'tourism' || (h.category === 'leisure' && h.type === 'resort')) && (h.extratags?.website || h.extratags?.['contact:website']));
      if (hit) return hit.extratags.website || hit.extratags['contact:website'];
    } catch (err) {
      warn(`Nominatim: ${err.message}`);
    }
  }
  return null;
}

/** Looks through a site's sitemap for the pages of one resort: its main page plus useful sub-pages. */
async function discoverInSitemap(origin, resort, depth = 0) {
  let xml;
  try {
    xml = await fetchText(`${origin}/sitemap.xml`, { timeout: 40_000, accept: 'application/xml,text/xml,*/*' });
  } catch {
    return [];
  }
  let locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  if (/<sitemapindex/i.test(xml) && depth === 0) {
    const children = [];
    for (const child of locs.slice(0, 6)) {
      try {
        children.push(...[...(await fetchText(child, { timeout: 40_000 })).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]));
      } catch {
        /* skip this child sitemap */
      }
    }
    locs = children;
  }
  const want = tokens(resort.nom);
  const slug = (u) => flat(decodeURIComponent(new URL(u).pathname));
  const matching = locs.filter((u) => want.every((t) => slug(u).split(' ').includes(t) || slug(u).includes(t)));
  if (!matching.length) return [];
  const langRank = (u) => ['en', 'fr'].indexOf(new URL(u).pathname.split('/')[1]) + 1 || 9;
  // Hotel pages first; news, blog and offer pages only if nothing else matches.
  const notHotel = (u) => (/\/(news|blog|press|offers?|promo\w*|stories)\//i.test(new URL(u).pathname) ? 1 : 0) + (/\/hotels?\//i.test(new URL(u).pathname) ? 0 : 1);
  const sorted = [...matching].sort((a, b) => notHotel(a) - notHotel(b) || langRank(a) - langRank(b) || a.length - b.length);
  const base = sorted[0];
  const useful = /(gastronomy|restaurants?|dining|facilities|services|activities|kids|spa)$/;
  const subs = matching.filter((u) => u.startsWith(`${base}/`) && useful.test(new URL(u).pathname));
  return [base, ...subs].slice(0, MAX_PAGES);
}

const KEYWORDS = /restaurant|\bbars?\b|pool|piscin|alberca|kids|child|enfant|nino|club|\bspa\b|wi-?fi|internet|beach|plage|playa|sand|room service|water ?park|aqua|toboggan|slide|splash|buffet|a la carte|lounge/i;

function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Text lines from the schema.org JSON-LD blocks (many JS-heavy sites keep their amenities there). */
function jsonLdLines(html) {
  const lines = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (['name', 'description', 'text', 'headline', 'slogan'].includes(k) && typeof v === 'string') lines.add(decode(v.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
      else if (v && typeof v === 'object') walk(v);
    }
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1]));
    } catch {
      /* malformed block: ignore */
    }
  }
  return [...lines].filter(Boolean);
}

function pageText(html) {
  const visible = decode(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template|iframe|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/tr|\/section|\/dd|\/dt)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean);
  return [...new Set([...visible, ...jsonLdLines(html)])].join('\n');
}

/** Keeps the lines about facilities (plus their neighbours) so a small model sees a short, relevant text. */
function condense(text) {
  const lines = text.split('\n');
  const keep = new Set();
  lines.forEach((l, i) => {
    if (KEYWORDS.test(norm(l))) [i - 1, i, i + 1].forEach((j) => j >= 0 && j < lines.length && keep.add(j));
  });
  const picked = [...keep].sort((a, b) => a - b).map((i) => lines[i]).join('\n');
  return (picked.length >= 300 ? picked : text).slice(0, MAX_CHARS);
}

async function readPage(url, resort) {
  const info = { url, status: 'ok', chars: 0 };
  try {
    if (!(await allowedByRobots(url))) return { ...info, status: 'interdit par robots.txt' };
    const html = await fetchText(url);
    const text = pageText(html);
    info.chars = text.length;
    if (text.length < 300) return { ...info, status: 'peu de texte (page chargée par JavaScript ?)' };
    // The hotel's own name must be in the page title (its first part) or in the address. Merely mentioning the
    // resort is not enough: "Riu Palace Quintana Roo, in Costa Mujeres" is another hotel.
    const title = decode((html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? '').trim());
    const namePart = title.split(/\s[·|–—]\s|\s-\s/)[0];
    const identity = flat(`${namePart} ${decodeURIComponent(new URL(url).pathname)}`);
    const want = tokens(resort.nom);
    const hit = want.filter((t) => identity.split(' ').includes(t)).length;
    if (hit / Math.max(want.length, 1) < 0.75) return { ...info, status: `ce n’est pas la page de ce resort (« ${namePart.slice(0, 50)} »)` };
    return { ...info, text, html };
  } catch (err) {
    return { ...info, status: `erreur : ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Layer 1: rules on structured data (no model)
// ---------------------------------------------------------------------------

const toNumber = (s) => {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** schema.org JSON-LD and the numbers a site embeds in its own app state. */
function structured(html) {
  const nodes = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap((m) => {
    try {
      const j = JSON.parse(m[1]);
      return j['@graph'] ?? (Array.isArray(j) ? j : [j]);
    } catch {
      return [];
    }
  });
  const hotel = nodes.find((n) => /Hotel|Resort|Lodging/i.test([].concat(n?.['@type'] ?? []).join(','))) ?? null;
  const amenities = (hotel?.amenityFeature ?? []).map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean);

  const out = { hotel, amenities, rating: null, stars: null, tripadvisorUrl: null };

  const ld = hotel?.aggregateRating ?? nodes.find((n) => n?.aggregateRating)?.aggregateRating;
  if (ld?.ratingValue) out.rating = { value: toNumber(ld.ratingValue), count: toNumber(ld.reviewCount ?? ld.ratingCount), via: 'le site du resort' };

  // Many hotel sites show a TripAdvisor widget; the figures sit in the page's own data.
  const ta = html.match(/"tripadvisor"\s*:\s*\[\s*(\{[^\]]*?\})\s*\]/);
  if (ta) {
    try {
      const o = JSON.parse(`[${ta[1]}]`)[0];
      if (toNumber(o.rating)) out.rating = { value: toNumber(o.rating), count: toNumber(o.reviews), via: 'TripAdvisor, affiché sur le site du resort' };
      if (o.id) out.tripadvisorUrl = `https://www.tripadvisor.com/Hotel_Review-d${o.id}`;
    } catch {
      /* unreadable widget data: skip */
    }
  }
  const same = [].concat(hotel?.sameAs ?? []).find((u) => /tripadvisor\./i.test(u));
  if (same) out.tripadvisorUrl = same;

  const stars = toNumber(hotel?.starRating?.ratingValue ?? html.match(/"stars"\s*:\s*"?(\d)"?/)?.[1]);
  if (stars && stars >= 1 && stars <= 5) out.stars = stars;
  return out;
}

const WORDS_BEFORE_COUNT = '(?:different|varied|diverse|distinct|international)\\s+';
const POOLS = new RegExp(`(\\d{1,2})\\s+(?:\\w+\\s+)?(?:pools?|piscinas?|piscines?)`, 'i');
const RESTAURANTS = new RegExp(`(\\d{1,2})\\s+(?:${WORDS_BEFORE_COUNT})?(?:restaurants?|restaurantes)\\b`, 'i');
const BARS = new RegExp(`(\\d{1,2})\\s+(?:${WORDS_BEFORE_COUNT})?bars?\\b`, 'i');

/** Every pool count the page states, digits or words, so a contradiction can be shown instead of hidden. */
const NUMBER_BY_WORD = new Map(Object.values(NUMBER_WORDS).flatMap((words) => words.map((w, n) => [w, n])).filter(([, n]) => n > 0));
function poolCountsIn(lines) {
  const found = new Set();
  const word = new RegExp(`\\b(${[...NUMBER_BY_WORD.keys()].join('|')})\\s+(?:\\w+\\s+)?(?:pools?|piscinas?|piscines?)`, 'gi');
  const digit = new RegExp(POOLS.source, 'gi');
  for (const l of lines) {
    for (const m of l.matchAll(digit)) found.add(Number(m[1]));
    for (const m of l.matchAll(word)) found.add(NUMBER_BY_WORD.get(m[1].toLowerCase()));
  }
  return found;
}

// Facilities named in the amenity list of the page: yes-answers only.
const AMENITY_RULES = [
  { field: 'clubEnfants', test: /kids|child|enfants?|ninos?|riu ?land/ },
  { field: 'parcAquatique', test: /water ?park|splash water world|parc aquatique|parque acuatico/ },
  { field: 'spaSurPlace', test: /\bspa\b|wellness/ },
  { field: 'serviceChambre24h', test: /room service|servicio de habitacion/ },
];

/** Reads the facts a page states in structured form. Fills entry.facts / entry.extras, first value wins. */
function applyRules(page, url, resort, entry) {
  const { html, text } = page;
  const { hotel, amenities, rating, stars, tripadvisorUrl } = structured(html);
  const fact = (field, value, quote, evidence) => {
    if (value == null || entry.facts[field] !== undefined) return;
    entry.facts[field] = { value, quote: String(quote).slice(0, 220), url, methode: 'regle', ...(evidence ? { evidence } : {}) };
  };
  const onPage = (q) => flat(text).includes(flat(q));
  const lines = text.split('\n');

  for (const { field, test } of AMENITY_RULES) {
    const hit = amenities.find((a) => test.test(flat(a)));
    if (hit && onPage(hit)) fact(field, true, hit);
  }

  const wifi = amenities.find((a) => /wi ?fi/.test(flat(a)));
  if (wifi && onPage(wifi)) fact('qualiteWifi', /free|gratuit|gratis|complimentary/i.test(wifi) ? 'gratuit' : /paid|fee|payant|de pago/i.test(wifi) ? 'payant' : null, wifi);

  // Counts: the declared amenity list first, then sentences of the text.
  for (const a of amenities) {
    const m = a.match(POOLS);
    if (m && onPage(a)) fact('nombrePiscines', Number(m[1]), a);
  }
  const gastronomyPage = /\/(gastronomy|restaurants?|dining|gastronomia|restauration)\/?$/i.test(new URL(url).pathname);
  if (gastronomyPage) {
    const n = lines.map((l) => l.match(/^\((\d{1,2})\)$/)).find(Boolean);
    if (n) fact('nombreRestaurants', Number(n[1]), `La page gastronomie du resort liste ${n[1]} restaurants`, 'liste');
  }
  for (const [field, re] of [['nombrePiscines', POOLS], ['nombreRestaurants', RESTAURANTS], ['nombreBars', BARS]]) {
    const line = lines.find((l) => re.test(l) && l.length < 600);
    if (line) fact(field, Number(line.match(re)[1]), line.match(new RegExp(`[^.!?]*${re.source}[^.!?]*`, 'i'))?.[0]?.trim() ?? line);
  }

  const pools = entry.facts.nombrePiscines;
  if (pools && pools.url === url && !pools.autres) {
    const others = [...poolCountsIn([...amenities, ...lines])].filter((n) => n !== pools.value);
    if (others.length) {
      pools.autres = others;
      pools.quote = `${pools.quote} (Le site indique aussi : ${others.join(', ')} piscines.)`.slice(0, 320);
    }
  }

  // Top-level figures, shown by the resort on its own page.
  const extra = (key, value, quote) => {
    if (value != null && entry.extras[key] === undefined) entry.extras[key] = { value, quote, url, methode: 'regle' };
  };
  if (rating?.value && rating.value > 0 && rating.value <= 5) {
    const q = `${rating.via} : ${String(rating.value).replace('.', ',')}/5${rating.count ? `, ${rating.count.toLocaleString('fr-CA')} avis` : ''}`;
    extra('noteGenerale', rating.value, q);
    extra('nombreAvis', rating.count, q);
  }
  extra('etoiles', stars, `${stars} étoiles, indiquées par le site du resort`);
  extra('lienTripadvisor', tripadvisorUrl, `Lien TripAdvisor donné par le site du resort`);
  if (!/wikipedia\.org/i.test(url)) extra('siteOfficiel', hotel?.url && new URL(hotel.url, url).origin === new URL(url).origin ? hotel.url : url.replace(/\/(gastronomy|restaurants?|dining|rooms?|gallery|events)\/?$/i, ''), 'Page officielle du resort');
}

// ---------------------------------------------------------------------------
// Layer 2: local model (Ollama)
// ---------------------------------------------------------------------------

async function ollamaModels() {
  const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
  return (await res.json()).models?.map((m) => m.name) ?? [];
}

function schemaFor(fields) {
  const props = {};
  for (const f of fields) {
    props[f] = {
      type: 'object',
      properties: { found: { type: 'boolean' }, value: { type: FIELDS[f].type, ...(FIELDS[f].enum ? { enum: FIELDS[f].enum } : {}) }, quote: { type: 'string' } },
      required: ['found', 'value', 'quote'],
    };
  }
  return { type: 'object', properties: props, required: fields };
}

const SYSTEM = `You extract facts about one hotel resort from the page text you are given.
Rules:
- Use ONLY the text provided. Never use outside knowledge.
- For each field, set found=true only if the text explicitly states it for THIS resort.
- "quote" must be copied EXACTLY, word for word, from the text (one sentence or phrase, 200 characters max).
- If the text does not state it: found=false, quote="", and value=false / 0 / "".
- For counts, give a number only if the text gives that explicit number.
Answer with JSON only.`;

/** POST /api/chat, retrying without `think` for models that have no thinking mode. */
async function chat(body) {
  const post = () => fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(600_000) });
  let res = await post();
  if (res.status === 400 && /think/i.test(await res.clone().text())) {
    delete body.think;
    res = await post();
  }
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** Short French version of a phrase found on a page (the site is in French; the quote stays in its original language). */
async function translateFr(text) {
  try {
    const res = await chat({
      model: MODEL,
      stream: false,
      think: false,
      options: { temperature: 0, num_ctx: 2048 },
      messages: [{ role: 'user', content: `Traduis en français en une courte phrase de 12 mots maximum, sans guillemets ni explication. Si c'est déjà en français, recopie-la.\n${text}` }],
    });
    const out = ((await res.json()).message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/["«»\n]/g, ' ').replace(/\s+/g, ' ').trim();
    return out && out.length <= 100 ? out : text;
  } catch {
    return text;
  }
}

async function askOllama(resort, url, text, fields) {
  const prompt = [
    `Resort: ${resort.nom}`,
    `Location: ${resort.destination ?? 'unknown'}`,
    `Page: ${url}`,
    '',
    'Find in the text below:',
    ...fields.map((f) => `- ${f}: ${FIELDS[f].ask}`),
    '',
    'TEXT:',
    '"""',
    text,
    '"""',
  ].join('\n');
  const body = {
    model: MODEL,
    stream: false,
    think: false,
    keep_alive: '10m',
    format: schemaFor(fields),
    options: { temperature: 0, num_ctx: 8192 },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: prompt },
    ],
  };
  const res = await chat(body);
  const content = (await res.json()).message?.content ?? '';
  return JSON.parse(content.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const resorts = await readJson(ENRICHED, []);
  if (!resorts.length) {
    console.error('[web] Aucun resort dans src/data/resorts-enriched.json : lancez d’abord `npm run enrich`.');
    process.exit(1);
  }

  // The model is optional: without it, the rules still run.
  let ai = false;
  if (!RULES_ONLY && !DRY) {
    try {
      const models = await ollamaModels();
      if (models.some((m) => m === MODEL || m === `${MODEL}:latest`)) {
        ai = true;
        log(`IA locale : ${MODEL} (${OLLAMA})`);
      } else {
        warn(`Le modèle « ${MODEL} » n’est pas installé : règles seulement. Pour l’IA : ollama pull ${MODEL}`);
      }
    } catch {
      warn(`Ollama ne répond pas sur ${OLLAMA} : règles seulement.`);
    }
  }

  const manual = await readJson(SOURCES, {});
  const results = await readJson(OUTPUT, {});
  const targets = resorts.filter((r) => !ONLY || r.id === ONLY);
  if (ONLY && !targets.length) {
    console.error(`[web] Resort inconnu : ${ONLY}. Ids : ${resorts.map((r) => r.id).join(', ')}`);
    process.exit(1);
  }

  // Candidate pages. Websites that OpenStreetMap knows give us the brand's site for its other resorts.
  const known = new Map();
  for (const e of Object.values(results)) for (const pg of e.pages ?? []) { try { known.set(new URL(pg.url).origin, true); } catch { /* ignore */ } }
  const plan = new Map();
  for (const r of targets) {
    const urls = [...(manual[r.id] ?? [])];
    if (r.siteOfficiel) urls.push(r.siteOfficiel);
    if (r.lienWikipedia) urls.push(r.lienWikipedia);
    if (!urls.length) {
      const site = await osmWebsite(r.nom);
      if (site) urls.push(site);
    }
    for (const u of urls) {
      try {
        known.set(new URL(u).origin, true);
      } catch {
        /* ignore malformed */
      }
    }
    plan.set(r.id, urls);
  }

  for (const r of targets) {
    const fromWeb = r.meta?.champsIA ?? {};
    const missing = Object.keys(FIELDS).filter((f) => r.infrastructures?.[f] == null || fromWeb[f]);
    const topMissing = ['noteGenerale', 'nombreAvis', 'etoiles', 'siteOfficiel', 'lienTripadvisor'].filter((f) => r[f] == null || fromWeb[f]);
    if (!missing.length && !topMissing.length) {
      log(`${r.nom} : rien à compléter.`);
      continue;
    }
    if (!FORCE && !DRY && results[r.id]) {
      log(`${r.nom} : déjà fait (--force pour refaire).`);
      continue;
    }
    log(`${r.nom} : ${missing.length} champ(s) à compléter…`);

    // Candidate pages: exact matches from the brand's sitemap first, then any other known address.
    const explicit = plan.get(r.id);
    const isPage = (u) => new URL(u).pathname.replace(/\/$/, '') !== '';
    const candidates = [];
    const brand = tokens(r.nom)[0];
    const origins = new Set(explicit.map((u) => new URL(u).origin));
    for (const o of known.keys()) if (brand && new URL(o).hostname.includes(brand)) origins.add(o);
    for (const o of origins) candidates.push(...(await discoverInSitemap(o, r)));
    candidates.push(...explicit.filter(isPage));
    const urls = [...new Set(candidates.map((u) => u.replace(/\/+$/, '')))].slice(0, MAX_PAGES + 3);
    if (!urls.length) {
      warn(`${r.nom} : aucune page trouvée. Ajoutez son adresse dans src/data/resorts-sources.json : { "${r.id}": ["https://…"] }`);
      continue;
    }

    const entry = { generatedAt: new Date().toISOString(), model: ai ? MODEL : null, officiel: false, pages: [], facts: {}, extras: {}, rejected: [], conflicts: [] };
    let pending = [...missing];
    let usable = 0;
    for (const url of urls) {
      if (usable >= MAX_PAGES) break;
      const page = await readPage(url, r);
      entry.pages.push({ url, status: page.status, chars: page.chars });
      log(`  ${url} : ${page.status} (${page.chars} caractères)`);
      if (!page.text) continue;
      usable += 1;
      if (!/wikipedia\.org/i.test(url)) entry.officiel = true;

      // Layer 1: rules.
      applyRules(page, url, r, entry);
      pending = pending.filter((f) => entry.facts[f] === undefined);

      // Layer 2: the model, only for what is still missing.
      if (!ai || !pending.length) continue;
      const condensed = condense(page.text);
      let answer;
      try {
        answer = await askOllama(r, url, condensed, pending);
      } catch (err) {
        warn(`  ${err.message}`);
        entry.pages.at(-1).status = `erreur du modèle : ${err.message}`;
        continue;
      }
      for (const field of pending) {
        const check = verify(field, answer?.[field], page.text);
        if (check.ok) {
          const kept = entry.facts[field];
          if (kept && kept.value !== check.value) entry.conflicts.push({ field, kept: kept.value, other: check.value, url });
          else if (!entry.facts[field]) entry.facts[field] = { value: FIELDS[field].translate ? await translateFr(check.value) : check.value, quote: check.quote, url, methode: 'ia' };
        } else if (answer?.[field]?.found) {
          entry.rejected.push({ field, reason: check.reason, quote: String(answer[field].quote ?? '').slice(0, 120), url });
        }
      }
      pending = pending.filter((f) => !entry.facts[f]);
    }

    const byRule = Object.values({ ...entry.facts, ...entry.extras }).filter((f) => f.methode === 'regle').length;
    const byAi = Object.values(entry.facts).filter((f) => f.methode === 'ia').length;
    if (DRY) {
      log(`  → à sec : ${byRule} fait(s) par règles. ${JSON.stringify(Object.fromEntries([...Object.entries(entry.facts), ...Object.entries(entry.extras)].map(([k, v]) => [k, v.value])))}`);
      continue;
    }
    results[r.id] = entry;
    for (const id of Object.keys(results)) if (!resorts.some((x) => x.id === id)) delete results[id]; // resorts removed from the list
    log(`  → ${byRule} fait(s) par règles, ${byAi} par l’IA, ${entry.rejected.length} rejeté(s)${entry.conflicts.length ? `, ${entry.conflicts.length} désaccord(s) entre pages` : ''}.`);
    await writeFile(OUTPUT, `${JSON.stringify(results, null, 2)}\n`); // saved after each resort: a long run can be stopped safely
  }

  if (!DRY) log('Terminé. Lancez `npm run enrich` pour intégrer les résultats au site.');
}

main().catch((err) => {
  console.error('[web] Échec :', err);
  process.exit(1);
});
