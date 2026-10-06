/** UI state kept in the URL hash so a link shares the selection, weights and filters. */
import type { Weights } from './score';

export interface UiState {
  /** visible resorts, in display order */
  order: string[];
  pin: string | null;
  diff: boolean;
  collapsed: string[];
  weights: Weights;
}

const clamp = (n: number) => Math.min(10, Math.max(0, Math.round(n)));

export function parseHash(hash: string, slugs: string[], defaults: Weights): UiState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const r = p.get('r');
  const order = r === null ? [...slugs] : [...new Set(r.split(',').filter((s) => slugs.includes(s)))];
  const pin = p.get('pin');
  const weights = { ...defaults };
  for (const pair of (p.get('w') ?? '').split(',')) {
    const [k, v] = pair.split(':');
    if (k && k in defaults && v !== undefined && Number.isFinite(Number(v))) weights[k] = clamp(Number(v));
  }
  return {
    order,
    pin: pin && order.includes(pin) ? pin : null,
    diff: p.get('diff') === '1',
    collapsed: (p.get('c') ?? '').split(',').filter(Boolean),
    weights,
  };
}

/** Compact: only what differs from the defaults. Empty string when nothing does. */
export function serializeHash(state: UiState, slugs: string[], defaults: Weights): string {
  const p = new URLSearchParams();
  if (state.order.join() !== slugs.join()) p.set('r', state.order.join(','));
  if (state.pin) p.set('pin', state.pin);
  if (state.diff) p.set('diff', '1');
  if (state.collapsed.length) p.set('c', state.collapsed.join(','));
  const w = Object.entries(state.weights).filter(([k, v]) => v !== defaults[k]).map(([k, v]) => `${k}:${v}`);
  if (w.length) p.set('w', w.join(','));
  const s = p.toString().replaceAll('%2C', ',').replaceAll('%3A', ':');
  return s ? `#${s}` : '';
}
