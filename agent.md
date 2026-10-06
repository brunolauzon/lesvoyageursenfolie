# agent.md — Resort Comparison Site ("Les voyageurs en folie")

You are building a **static website** that compares vacation resorts side by side.
The user gives a list of hotel names. The build pipeline fetches everything else, renders it, and publishes to GitHub Pages.

Read this whole file before writing code. Work phase by phase (section 12). Commit after each phase.

---

## 1. Goal

Input: `data/resorts.yml` — a list of hotel names (nothing else is required).

Output: a static site with
1. A **comparison page** with all resorts side by side.
2. One **detail page per resort**.
3. **Historical weather graphs** for the trip week.
4. **Door-to-door travel time** from Montréal airport (YUL), including the airport → resort transfer.
5. **Facility comparison** with all decision-making info.
6. **Automatic fetching** of missing info, with a manual-override escape hatch.

Adding a resort = add one line to `resorts.yml`, push, done.

## 2. Fixed trip parameters

Put these in `data/trip.yml`. Never hard-code them in components.

```yaml
origin:
  airport: YUL            # Montréal-Trudeau
  lat: 45.4706
  lon: -73.7408
travelers: 2              # adjust
stay:
  start: 2027-01-16       # Saturday
  end: 2027-01-23         # 7 nights (assumption: "week of Jan 16" = Jan 16 to Jan 22 inclusive)
currency: CAD
locale: fr-CA             # UI language. Keep strings in src/i18n/fr.json so EN can be added later.
weather_history_years: 10 # how many past years feed the graphs
```

If the date window is ambiguous, keep the assumption above and flag it in the README. Do not stop to ask.

## 3. Tech stack (already decided)

The repo already contains `.github/workflows/deploy.yml` which uses `withastro/action@v3` and runs `npm run build`.

- **Astro** (static output). Zero JS by default; small vanilla-JS islands only where interactivity is needed.
- **TypeScript** for scripts and types. **Zod** to validate every data file.
- **Node 22.**
- **Charts: pre-rendered inline SVG** generated at build time in `.astro` components. No runtime chart library, so graphs are fast, print well, and work with JS off.
- **Maps:** Leaflet + OpenStreetMap tiles (loaded lazily, one island). Fallback: static SVG route sketch.
- Set `site` and `base` in `astro.config.mjs` for GitHub Pages project hosting (`base: '/lesvoyageursenfolie'`). All links must respect `import.meta.env.BASE_URL`.
- Styling: plain CSS with custom properties, light + dark mode, mobile first. No heavy framework.

"Dynamic stuff is rendered before commit" translates to:

- **Fetchers run at build time and write JSON to `data/cache/`.** That folder **is committed**, so builds are reproducible and offline-safe.
- The deploy workflow only runs `astro build`. It does **not** need network access to any data API unless the cache is stale (see section 9).
- `npm run build` runs the `prebuild` hook (`scripts/fetch-resort-data.ts`) first. It must be a no-op when the cache is fresh.

## 4. Repo layout

```
agent.md
data/
  resorts.yml              # USER INPUT: names only (+ optional hints)
  trip.yml                 # section 2
  overrides/<slug>.yml     # hand-written facts; always win over fetched data
  cache/<slug>/            # fetched JSON per provider, committed
    weather.json
    travel.json
    facilities.json
    meta.json              # fetchedAt, provider, confidence per field
  reference/
    airports.csv           # OurAirports dump (committed, rarely changes)
    flight-times.yml       # curated nonstop times YUL -> airport (fallback)
scripts/
  fetch-resort-data.ts     # orchestrator (prebuild)
  providers/               # one file per data source (section 5-7)
  lib/                     # http (retry, cache, rate-limit), geo, merge, slugify
src/
  pages/index.astro        # comparison
  pages/resorts/[slug].astro
  components/              # charts, tables, cards, map, score
  schema/                  # zod schemas
  i18n/fr.json
.github/workflows/
  deploy.yml               # exists
  refresh-data.yml         # NEW: weekly + manual refresh, commits cache (section 9)
```

## 5. Input format

`data/resorts.yml`:

```yaml
- name: "Iberostar Selection Varadero"      # required
- name: "Hotel Riu Palace Punta Cana"
  location: "Punta Cana, Dominican Republic" # optional hint, helps disambiguation
  url: "https://www.riu.com/..."            # optional official site
  price_cad: 3200                           # optional, manual (no free price API)
  notes: "Recommended by Marc"              # optional
```

Resolution step (`providers/resolve.ts`) turns a name into a canonical record:
`slug`, official name, lat/lon, address, country, official website, Google place id, Wikidata id.
Use, in order: Google Places Text Search (if key) -> Nominatim (OSM) -> Wikidata search.
If more than one plausible match, pick the best by name similarity + "lodging" type, record the alternatives in `meta.json`, and **fail the build with a clear message when confidence is below 0.6** so a wrong hotel never ships silently. The message tells the user to add `location:` or `url:` to the entry.

## 6. Feature A — Historical weather (week of Jan 16, 2027)

**Source:** Open-Meteo. Free, no key.
- Historical daily data: `https://archive-api.open-meteo.com/v1/archive` (ERA5 reanalysis).
- Sea temperature: `https://marine-api.open-meteo.com/v1/marine` (sea surface temperature). Skip gracefully if the point is inland.

**Method**
1. For each of the last `weather_history_years` full years, fetch daily data for `Jan 16 -> Jan 22` (use Jan 9 -> Jan 29 so we can show context and smooth).
2. Variables: `temperature_2m_max`, `temperature_2m_min`, `precipitation_sum`, `rain_sum`, `sunshine_duration`, `wind_speed_10m_max`, `relative_humidity_2m_mean`, `uv_index_max`, `cloud_cover_mean`.
3. Aggregate per calendar day: mean, min, max, p10, p90 across years.
4. Compute trip-week summary: avg high/low, % of rainy days (>1 mm), avg sunshine hours/day, avg wind, avg UV, avg sea temp.
5. Write `data/cache/<slug>/weather.json` with the raw years and the aggregates.

**Graphs (SVG, build-time)** — on the detail page and on the comparison page:
- Temperature band: high/low mean lines per day, shaded p10-p90 range, trip week highlighted.
- Precipitation probability + amount bars.
- Sunshine hours bars.
- Sea temperature line/badge.
- **Comparison overlay:** all resorts on one chart (one line per resort, same y-axis), with a toggle for metric.
- Clear caption: "Historical average, {N} years, ERA5 reanalysis. Not a forecast." Include Open-Meteo attribution (CC BY 4.0).
- Metric as °C (primary) with °F available via toggle only if time permits.

**Forecast note:** the trip is in Jan 2027. When the current date is within 14 days of the trip, also fetch the Open-Meteo forecast and overlay it. Otherwise show history only.

## 7. Feature B — Travel time from Montréal (door to door)

Goal: "How long until I'm at the resort pool?" A single number plus a breakdown.

**Breakdown per resort**
```
[Home -> YUL, optional, user-configurable default 0]
+ Airport check-in buffer        (default 120 min international, config)
+ Flight time                    (nonstop duration, else fastest 1-stop)
+ Arrival buffer                 (immigration + bags, default 60 min, config)
+ Ground transfer: arrival airport -> resort   (driving time)
= Total door to door
```
Show: total, flight time, stops (nonstop / 1 stop), transfer time, transfer distance, timezone difference (so people know the jet lag).

**Finding the arrival airport:** nearest commercial airport with scheduled service to the resort (`airports.csv`, `type in (large_airport, medium_airport)` and `scheduled_service = yes`). Allow `override.airport` since the nearest one is not always the one with flights from YUL.

**Flight time, in order of preference**
1. `data/reference/flight-times.yml` — curated nonstop durations from YUL (Air Canada, Transat, Sunwing, WestJet, Air Transat). Hand-maintained, small, reliable. Seed it from the airlines' schedules.
2. Amadeus Self-Service Flight Offers Search API (if `AMADEUS_CLIENT_ID/SECRET` exist): search YUL -> destination on 2027-01-16 and return 2027-01-23, take the fastest itinerary and cheapest price. Store duration, stops, carriers. (Do not scrape Google Flights/Skyscanner.)
3. Estimate: great-circle distance / 800 km/h + 30 min, flag `estimated: true` and show an "estimate" badge in the UI.

**Ground transfer time:** OSRM public demo server (`router.project-osrm.org`) or OpenRouteService (key optional) for driving duration and distance, airport -> resort. Add a 15% safety margin and a note. If routing fails, fall back to straight-line distance / 50 km/h flagged as an estimate.

**Visuals**
- Stacked horizontal bar per resort: buffer / flight / immigration / transfer.
- Sorted "fastest to slowest" ranking.
- Map with the route YUL -> airport (great circle) and airport -> resort (road).

## 8. Feature C — Facilities and decision data

The point: the user should never need to open ten tabs. Collect these fields (schema in `src/schema/resort.ts`, every field optional, every field carries `source` + `confidence` + `fetchedAt`):

**Essentials**
- Name, stars (official), guest rating + review count (Google/TripAdvisor *rating only via official APIs*), price range / price per person (manual or Amadeus Hotel API), photo links.
- All-inclusive? (yes/no/partial), adults-only?, kids club?, family rooms?
- Beach: on beachfront? sand/rock, swimming safe? (notes), distance to beach in m.
- Pools: count, heated, swim-up bar, kids pool, adults-only pool.
- Food: number of restaurants, à la carte reservations needed?, buffet, 24h snack, dietary options (vegetarian, gluten-free), bars count, alcohol quality tier (national / premium).
- Rooms: sizes, swim-up rooms, suites, ocean view availability, room features.
- Activities: water sports (non-motorized/motorized), tennis, golf, spa (included?), gym, nightly shows, excursions, diving, kids' activities.
- Practical: Wi-Fi (free? all areas?), airport distance and transfer time, nearest town distance, accessibility (wheelchair), pets, languages spoken, check-in/out times, resort size (rooms), renovation year.
- Sustainability / safety notes if available (sargassum risk in Jan, hurricane season n/a for Jan, travel advisories from the Government of Canada, plug type + voltage, currency, tipping, visa/eTA, vaccines).

**Fetch strategy — a provider chain with fallback and merge**

Each provider returns `Partial<Resort>` with per-field provenance. The merger fills each field from the first provider that has it, in this priority:

1. `data/overrides/<slug>.yml` (human, always wins)
2. Official hotel website: fetch `url`, parse JSON-LD (`schema.org/Hotel`, `amenityFeature`), OpenGraph, and the "facilities" page. Respect `robots.txt`; honor a 1 req/s rate limit; identify with a descriptive User-Agent including the repo URL.
3. Google Places API (New): rating, review count, price level, website, phone, coordinates, opening info, editorial summary. Key from `GOOGLE_PLACES_API_KEY` (already wired in the workflow). Cache fields allowed by Google's terms only. **Do not download or re-host Google photos**; link with attribution, or skip.
4. OpenStreetMap Overpass: `tourism=hotel|resort`, tags `swimming_pool`, `beach`, `internet_access`, `wheelchair`, `stars`, nearby beach/town distance.
5. Wikidata / Wikipedia / Wikimedia Commons: stars, opening year, room count, and **freely licensed photos** (store license + author for attribution).
6. **LLM extraction fallback (optional)**: when fields remain missing after steps 2-5, send the official site's visible text (cleaned) to the Claude API (`ANTHROPIC_API_KEY`, use `claude-sonnet-5-5`) with a strict JSON schema. Mark every value `source: "llm"`, `confidence <= 0.6`, and show a "to verify" badge in the UI. Never invent values: schema allows `null`, prompt says "return null if not stated in the text".

**Rules for fetching**
- Never scrape sites whose terms forbid it (TripAdvisor, Booking.com, Expedia, Google Search results). Use official APIs or skip.
- All HTTP goes through `scripts/lib/http.ts`: timeout 15 s, 3 retries with backoff, on-disk cache keyed by URL, per-host rate limit.
- A provider failing must **never fail the build**. Log it, keep the previous cache, continue. Only the resolve step (section 5) may fail the build.
- Every cached value stores `fetchedAt`. TTL: facilities 30 days, weather 365 days (history does not change), travel 14 days.
- `npm run fetch -- --force` or `--resort <slug>` refreshes selectively.
- **Missing-data report:** after the run, write `data/cache/_report.md` listing each resort's missing fields, so the user knows exactly what to override by hand.

## 9. Refresh automation

Add `.github/workflows/refresh-data.yml`:
- Triggers: `workflow_dispatch` and weekly cron.
- Steps: checkout, install, `npm run fetch`, commit changes to `data/cache/` if any (use the `github-actions[bot]` identity), push to `main`. The existing deploy workflow then rebuilds the site.
- Secrets (all optional, the site must build without any of them): `GOOGLE_PLACES_API_KEY`, `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `ORS_API_KEY`.
- Never print secrets. Never commit `.env`. (`.gitignore` already excludes it.)

## 10. UI / UX requirements

**Comparison page (`/`)**
- Sticky header row with resort names and photo; sticky first column on mobile with horizontal scroll.
- Sections (collapsible): Overview, Weather, Travel, Food, Beach and pools, Rooms, Activities, Practical.
- **Highlight best/worst per row** (green/red, with an icon and text, not color alone).
- "Show only differences" toggle: hide rows where all resorts are equal.
- Remove/reorder resorts, pin a favourite. State saved in the URL hash so a link is shareable.
- Missing data shown as "?" with a tooltip; unverified/LLM data shown with a small "to verify" badge; manual override shown with a pencil badge.
- Source and "updated on" date on hover for every cell.

**Weighted score ("Which one should we pick?")**
- Sliders for weights: weather, travel time, beach, food, pool, kids, price, rating, activities.
- Compute a 0-100 score per resort client-side (tiny island), re-rank live, store weights in URL hash.
- Show the formula and a breakdown per criterion. Normalize each criterion min-max across the selected resorts. Missing values are excluded and the weight is redistributed, with a visible warning.
- Radar chart (SVG) of the top criteria.

**Extra nice-to-haves, in priority order**
1. Pros/cons auto-generated from the data (e.g. "Shortest transfer: 15 min", "Only resort without swim-up rooms").
2. "Winner by category" cards at the top (warmest, shortest trip, best rated, cheapest, best for kids).
3. Map with all resorts + route lines + distance to beach/town.
4. Price block: manual `price_cad`, per person per night, cost-per-day-of-sun metric.
5. Vote page: static page where each person's pick is a URL param, plus a printable summary.
6. Print stylesheet: one clean page per resort + the comparison table, landscape.
7. Packing / documents checklist for the destination (passport validity, eTA, plug type, currency, tips), generated from country data.
8. Dark mode, keyboard navigation, `prefers-reduced-motion` respected.
9. Open Graph image per resort (generated at build) so shared links look good in chat apps.

## 11. Quality bar

- `npm run build` passes with **zero secrets** set and with **no network** (uses cache).
- `npm run check` (`astro check` + `tsc` + zod validation of all data) passes.
- Add **unit tests** (Vitest) for: slug, merge priority, weather aggregation, travel total, score normalization with missing values.
- Lighthouse on `/`: Performance >= 90, Accessibility >= 95 on mobile.
- WCAG AA contrast, all charts have a text alternative (`<title>`/`<desc>` + a data table under a `<details>`).
- No layout shift, no horizontal page scroll at 360 px width.
- Dates and numbers formatted with `Intl` for `fr-CA` (24 h clock, `1 234,5`, `$ CAD`).
- Attribution page/footer: Open-Meteo, OpenStreetMap, OurAirports, Wikimedia, Google (as required), and "data may be outdated, verify before booking".

## 12. Build order

Stop and show results after each phase.

1. **Scaffold:** Astro + TS + Zod + Vitest, `astro.config.mjs` with base, layout, i18n, CSS tokens, `resorts.yml` with 3 sample resorts, `trip.yml`. Confirm the existing deploy workflow still builds.
2. **Resolve + cache plumbing:** `http.ts`, resolve provider, slugs, `meta.json`, prebuild orchestrator, `_report.md`.
3. **Weather:** provider, aggregation, SVG charts, detail page section, overlay chart on the comparison page.
4. **Travel:** airports data, flight-times seed, OSRM transfer, breakdown component, stacked bar, ranking.
5. **Facilities:** schema, providers in order (official site, Places, OSM, Wikidata), merge, overrides, comparison table with highlights and "differences only".
6. **LLM fallback** (optional, behind the key) and the missing-data report polish.
7. **Score + radar + winner cards + URL-hash state.**
8. **Map, print stylesheet, OG images, vote page.**
9. **`refresh-data.yml`, README** (how to add a resort, how to override, how to refresh, which secrets exist).
10. **Quality pass:** tests, Lighthouse, a11y, offline build.

## 13. Hard rules

- Never fabricate data. Unknown = `null` and shown as "?".
- Never commit secrets. Never print secrets in logs.
- Never fail the build because an optional provider failed.
- Never hot-link Google photos or re-host copyrighted images; use Wikimedia Commons (with attribution) or an `og:image` link from the official site.
- Respect robots.txt and rate limits. Nominatim: max 1 req/s and a valid User-Agent.
- Keep hard-coded values out of components: all trip parameters come from `data/trip.yml`.
- Prefer small, boring, dependency-light solutions.
- Commit messages: imperative, one change per commit.

## 14. Definition of done

- Adding `- name: "X"` to `data/resorts.yml` and running `npm run build` produces a complete page for X with weather, travel, facilities, and a list of what is missing.
- The site is live on GitHub Pages and every internal link works under the `/lesvoyageursenfolie/` base path.
- `README.md` explains the 3 user actions: add a resort, override a fact, refresh data.
