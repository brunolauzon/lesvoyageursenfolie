/**
 * Single entry point for all outbound HTTP:
 * 15 s timeout, 3 retries with backoff, on-disk cache keyed by request, per-host rate limit.
 * The cache lives in .cache/http (gitignored). A stale entry is served if the network fails.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const REPO_URL = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
  : 'https://github.com/brunolauzon/lesvoyageursenfolie';
export const USER_AGENT = `lesvoyageursenfolie/0.1 (+${REPO_URL})`;

const TIMEOUT_MS = 15_000;
const RETRIES = 3;
const BACKOFF_MS = 500;
const DEFAULT_TTL_MS = 24 * 3600_000;
const DEFAULT_INTERVAL_MS = 250;
const HOST_INTERVAL_MS: Record<string, number> = {
  'nominatim.openstreetmap.org': 1100, // usage policy: max 1 req/s
  'router.project-osrm.org': 1000,
};

const cacheDir = join(process.cwd(), '.cache', 'http');
const state = { force: false };

export function configureHttp(opts: { force?: boolean }): void {
  state.force = opts.force ?? false;
}

export interface HttpOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** How long a cached response counts as fresh. Default 24 h. */
  ttlMs?: number;
  /** false for responses that carry secrets (tokens): never read from or written to disk. */
  cache?: boolean;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retriable: boolean,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// One promise chain per host: calls to the same host are spaced by its minimum interval.
const gates = new Map<string, Promise<void>>();
const lastCall = new Map<string, number>();

function waitTurn(host: string): Promise<void> {
  const interval = HOST_INTERVAL_MS[host] ?? DEFAULT_INTERVAL_MS;
  const next = (gates.get(host) ?? Promise.resolve()).then(async () => {
    const wait = (lastCall.get(host) ?? 0) + interval - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall.set(host, Date.now());
  });
  gates.set(host, next);
  return next;
}

async function once(url: URL, opts: HttpOptions): Promise<string> {
  // OFFLINE=1 simulates a missing network: only the on-disk cache can answer.
  if (process.env.OFFLINE) throw new HttpError(`Offline mode: ${url.host} not reachable`, null, false);
  await waitTurn(url.host);
  const label = `${url.host}${url.pathname}`; // never log the query string
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...opts.headers },
      body: opts.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new HttpError(`Network error for ${label}: ${reason}`, null, true);
  }
  if (res.ok) return res.text();
  throw new HttpError(`HTTP ${res.status} for ${label}`, res.status, res.status === 429 || res.status >= 500);
}

async function withRetries(url: URL, opts: HttpOptions): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await once(url, opts);
    } catch (err) {
      if (!(err instanceof HttpError) || !err.retriable || attempt >= RETRIES) throw err;
      await sleep(BACKOFF_MS * 2 ** attempt);
    }
  }
}

interface CacheEntry {
  fetchedAt: number;
  body: string;
}

async function readEntry(file: string): Promise<CacheEntry | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as CacheEntry;
  } catch {
    return null;
  }
}

export async function http(rawUrl: string, opts: HttpOptions = {}): Promise<string> {
  const url = new URL(rawUrl);
  // Headers (API keys) are deliberately not part of the key or the stored entry.
  const key = createHash('sha256').update(`${opts.method ?? 'GET'} ${url.href} ${opts.body ?? ''}`).digest('hex');
  const file = join(cacheDir, `${key}.json`);
  const useCache = opts.cache !== false;
  const cached = useCache ? await readEntry(file) : null;
  if (cached && !state.force && Date.now() - cached.fetchedAt < (opts.ttlMs ?? DEFAULT_TTL_MS)) {
    return cached.body;
  }
  try {
    const body = await withRetries(url, opts);
    if (useCache) {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(file, JSON.stringify({ fetchedAt: Date.now(), body } satisfies CacheEntry));
    }
    return body;
  } catch (err) {
    if (cached) {
      console.warn(`[http] ${url.host} failed, using stale cache`);
      return cached.body;
    }
    throw err;
  }
}

export async function httpJson(rawUrl: string, opts: HttpOptions = {}): Promise<unknown> {
  return JSON.parse(await http(rawUrl, opts));
}
