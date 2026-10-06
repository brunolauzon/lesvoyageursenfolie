/**
 * HTML for the score panel as strings, so the build and the browser render the exact same markup.
 * Browser-safe: no file access, locale passed in.
 */
import { t } from './i18n';
import type { Criterion, ResortScore, Weights } from './score';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const DASH = ['', '6 3', '2 3', '8 3 2 3', '10 4', '1 4', '4 2 1 2', '12 3 2 3'];

export interface View {
  locale: string;
  names: Record<string, string>;
  /** stable colour/dash index per resort */
  colorIndex: Record<string, number>;
}

const series = (v: View, slug: string) => (v.colorIndex[slug] ?? 0) % 8;

export function renderRanking(scores: ResortScore[], criteria: Criterion[], weights: Weights, v: View): string {
  if (scores.length < 2) return `<p class="muted">${esc(t('score.onlyOne'))}</p>`;
  const num = new Intl.NumberFormat(v.locale, { maximumFractionDigits: 0 });
  const weighted = criteria.filter((c) => (weights[c.key] ?? 0) > 0);

  const items = scores
    .map((s) => {
      const pct = s.total ?? 0;
      return `<li><div class="rank-head"><span>${esc(v.names[s.slug] ?? s.slug)}</span><strong>${s.total === null ? esc(t('score.noScore')) : esc(t('score.points', { n: num.format(s.total) }))}</strong></div>` +
        `<div class="rank-track" aria-hidden="true"><div class="rank-bar" style="width:${pct}%;background:var(--s${series(v, s.slug) + 1})"></div></div></li>`;
    })
    .join('');

  const warnings = scores
    .filter((s) => s.missing.length)
    .map((s) => `<p class="warn" role="note">⚠ ${esc(t('score.missingWarning', { name: v.names[s.slug] ?? s.slug, list: s.missing.map((k) => t(`score.criteria.${k}`)).join(', ') }))}</p>`)
    .join('');

  const head = `<tr><th scope="col">${esc(t('score.criterion'))}</th>${scores.map((s) => `<th scope="col">${esc(v.names[s.slug] ?? s.slug)}</th>`).join('')}</tr>`;
  const body = weighted
    .map((c) => `<tr><th scope="row">${esc(c.label)} <span class="muted">(${weights[c.key]})</span></th>${scores
      .map((s) => {
        const val = s.perCriterion[c.key];
        return val === null || val === undefined ? '<td><abbr title="' + esc(t('badge.missing')) + '">?</abbr></td>' : `<td>${num.format(val * 100)} % <span class="muted">· ${esc(t('score.contribution', { pts: new Intl.NumberFormat(v.locale, { maximumFractionDigits: 1 }).format(s.points[c.key] ?? 0) }))}</span></td>`;
      })
      .join('')}</tr>`)
    .join('');

  return `<ol class="rank-list">${items}</ol>${warnings}<details><summary>${esc(t('score.breakdown'))}</summary><div class="table-scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div></details>`;
}

export function renderRadar(scores: ResortScore[], criteria: Criterion[], weights: Weights, v: View): string {
  const axes = criteria.filter((c) => (weights[c.key] ?? 0) > 0);
  if (axes.length < 3 || scores.length < 1) return '';
  const cx = 180, cy = 165, R = 105;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
  const pt = (i: number, r: number) => `${(cx + Math.cos(angle(i)) * r).toFixed(1)},${(cy + Math.sin(angle(i)) * r).toFixed(1)}`;

  const rings = [0.25, 0.5, 0.75, 1].map((f) => `<polygon class="radar-ring" points="${axes.map((_, i) => pt(i, R * f)).join(' ')}" fill="none"/>`).join('');
  const spokes = axes.map((_, i) => `<line class="radar-ring" x1="${cx}" y1="${cy}" x2="${pt(i, R).split(',')[0]}" y2="${pt(i, R).split(',')[1]}"/>`).join('');
  const labels = axes
    .map((c, i) => {
      const [x, y] = pt(i, R + 16).split(',').map(Number) as [number, number];
      const anchor = Math.abs(x - cx) < 6 ? 'middle' : x < cx ? 'end' : 'start';
      return `<text x="${x}" y="${y + 4}" text-anchor="${anchor}">${esc(c.label)}</text>`;
    })
    .join('');
  const shapes = scores
    .map((s) => {
      const k = series(v, s.slug);
      const points = axes.map((c, i) => pt(i, R * (s.perCriterion[c.key] ?? 0))).join(' ');
      return `<polygon points="${points}" fill="var(--s${k + 1})" fill-opacity=".12" stroke="var(--s${k + 1})" stroke-width="2.5"${DASH[k] ? ` stroke-dasharray="${DASH[k]}"` : ''}/>`;
    })
    .join('');
  const pct = new Intl.NumberFormat(v.locale, { style: 'percent', maximumFractionDigits: 0 });
  const desc = scores.map((s) => `${v.names[s.slug]}: ${axes.map((c) => `${c.label} ${s.perCriterion[c.key] == null ? '?' : pct.format(s.perCriterion[c.key]!)}`).join(', ')}`).join('. ');
  const legend = scores
    .map((s) => { const k = series(v, s.slug); return `<li><svg class="key" viewBox="0 0 28 10" aria-hidden="true"><line x1="0" x2="28" y1="5" y2="5" stroke="var(--s${k + 1})" stroke-width="2.5"${DASH[k] ? ` stroke-dasharray="${DASH[k]}"` : ''}/></svg>${esc(v.names[s.slug] ?? s.slug)}</li>`; })
    .join('');

  return `<figure class="chart"><figcaption class="chart-title">${esc(t('score.radarTitle'))}</figcaption><ul class="legend">${legend}</ul>` +
    `<svg viewBox="0 0 360 330" role="img" aria-labelledby="radar-t radar-d" class="chart-svg radar"><title id="radar-t">${esc(t('score.radarTitle'))}</title><desc id="radar-d">${esc(t('score.radarDesc'))} ${esc(desc)}</desc>${rings}${spokes}${shapes}${labels}</svg></figure>`;
}

interface WinnerDef { label: string; criterion: string; subs: string[]; dir: 'high' | 'low' }
const WINNERS: WinnerDef[] = [
  { label: 'winnerWarmest', criterion: 'weather', subs: ['avgHigh'], dir: 'high' },
  { label: 'winnerShortest', criterion: 'travel', subs: ['total'], dir: 'low' },
  { label: 'winnerRated', criterion: 'rating', subs: ['rating'], dir: 'high' },
  { label: 'winnerCheapest', criterion: 'price', subs: ['price'], dir: 'low' },
  { label: 'winnerKids', criterion: 'kids', subs: ['kidsClub', 'kidsPool', 'familyRooms', 'kidsActivities'], dir: 'high' },
];

export function renderWinners(criteria: Criterion[], slugs: string[], v: View): string {
  const cards = WINNERS.map((w) => {
    const crit = criteria.find((c) => c.key === w.criterion);
    const subs = crit?.subs.filter((s) => w.subs.includes(s.key)) ?? [];
    const values = slugs.map((slug) => {
      const known = subs.map((s) => s.values[slug]).filter((x): x is number => x !== null && x !== undefined);
      return known.length ? known.reduce((a, b) => a + b, 0) : null;
    });
    const known = values.filter((x): x is number => x !== null);
    let body = `<span class="muted">${esc(t('score.winnerNone'))}</span>`;
    if (known.length && slugs.length > 1) {
      const best = w.dir === 'high' ? Math.max(...known) : Math.min(...known);
      const winners = slugs.filter((_, i) => values[i] === best);
      body = winners.length === slugs.length && new Set(known).size === 1
        ? `<span class="muted">${esc(t('score.winnerTie'))}</span>`
        : winners.map((s) => `<strong>${esc(v.names[s] ?? s)}</strong>`).join(', ');
    }
    return `<li class="winner"><span class="winner-label">${esc(t(`score.${w.label}`))}</span>${body}</li>`;
  }).join('');
  return `<ul class="winners">${cards}</ul>`;
}
