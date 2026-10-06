/** Comparison page interactivity: remove/reorder/pin, differences only, sections, live score. State lives in the URL hash. */
import { differs, rank } from '../lib/compare';
import { parseHash, serializeHash, type UiState } from '../lib/hash-state';
import { t } from '../lib/i18n';
import { computeScores, type Criterion, type Weights } from '../lib/score';
import { renderRadar, renderRanking, renderWinners, type View } from '../lib/score-view';

const table = document.querySelector<HTMLTableElement>('#cmp-table');
const dataEl = document.querySelector('#score-data');
if (table && dataEl) {
  const { criteria, view, weights: defaults } = JSON.parse(dataEl.textContent!) as { criteria: Criterion[]; view: View; weights: Weights };
  const slugs = Object.keys(view.names);
  const nameOf = (s: string) => view.names[s] ?? s;
  const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel);

  let state: UiState = parseHash(location.hash, slugs, defaults);

  const cellsBySlug = (tr: HTMLTableRowElement) => new Map([...tr.querySelectorAll<HTMLElement>('[data-slug]')].map((c) => [c.dataset.slug!, c]));

  function renderTable() {
    const shown = state.pin ? [state.pin, ...state.order.filter((s) => s !== state.pin)] : state.order;
    const hidden = slugs.filter((s) => !shown.includes(s));
    for (const tr of table!.querySelectorAll<HTMLTableRowElement>('thead tr, tr[data-row]')) {
      const cells = cellsBySlug(tr);
      for (const s of [...shown, ...hidden]) {
        const c = cells.get(s);
        if (!c) continue;
        c.hidden = hidden.includes(s);
        tr.appendChild(c);
      }
    }
    // best/worst among the visible resorts only
    for (const tr of table!.querySelectorAll<HTMLTableRowElement>('tr[data-row]')) {
      const cells = cellsBySlug(tr);
      const visible = shown.map((s) => cells.get(s)!);
      const scores = visible.map((c) => (c.dataset.score === '' ? null : Number(c.dataset.score)));
      const r = rank(scores, (tr.dataset.dir || null) as 'high' | 'low' | null);
      visible.forEach((c, i) => {
        c.classList.toggle('best', r.best.has(i));
        c.classList.toggle('worst', r.worst.has(i));
        c.querySelector<HTMLElement>('.mark-best')!.hidden = !r.best.has(i);
        c.querySelector<HTMLElement>('.mark-worst')!.hidden = !r.worst.has(i);
      });
      tr.hidden = state.diff && !differs(visible.map((c) => c.dataset.sig ?? ''));
      tr.dataset.diffHidden = tr.hidden ? '1' : '';
    }
    for (const tb of table!.querySelectorAll<HTMLTableSectionElement>('tbody[data-section]')) {
      const key = tb.dataset.section!;
      const collapsed = state.collapsed.includes(key);
      const rows = [...tb.querySelectorAll<HTMLTableRowElement>('tr[data-row]')];
      rows.forEach((tr) => { if (collapsed) tr.hidden = true; });
      tb.querySelector<HTMLElement>('.group-row')!.hidden = state.diff && rows.every((tr) => tr.dataset.diffHidden === '1');
      tb.querySelector('.group-btn')!.setAttribute('aria-expanded', String(!collapsed));
      tb.classList.toggle('collapsed', collapsed);
    }
    $<HTMLInputElement>('#diff-toggle')!.checked = state.diff;
    renderControls(hidden);
  }

  function btn(label: string, text: string, onClick: () => void, pressed?: boolean) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.textContent = text;
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onClick);
    return b;
  }

  function renderControls(hidden: string[]) {
    for (const th of table!.querySelectorAll<HTMLElement>('thead th[data-slug]')) {
      const s = th.dataset.slug!;
      const box = th.querySelector<HTMLElement>('[data-ctrl]')!;
      box.replaceChildren();
      if (hidden.includes(s)) continue;
      const i = state.order.indexOf(s);
      const pinned = state.pin === s;
      box.append(
        btn(t(pinned ? 'compare.unpin' : 'compare.pin', { name: nameOf(s) }), pinned ? '★' : '☆', () => update({ pin: pinned ? null : s }), pinned),
        btn(t('compare.moveLeft', { name: nameOf(s) }), '←', () => move(s, -1)),
        btn(t('compare.moveRight', { name: nameOf(s) }), '→', () => move(s, 1)),
        btn(t('compare.remove', { name: nameOf(s) }), '✕', () => update({ order: state.order.filter((x) => x !== s), pin: pinned ? null : state.pin })),
      );
      (box.children[1] as HTMLButtonElement).disabled = i <= 0;
      (box.children[2] as HTMLButtonElement).disabled = i === state.order.length - 1;
    }
    const holder = $<HTMLElement>('#removed')!;
    const list = $<HTMLElement>('#removed-list')!;
    list.replaceChildren(
      ...hidden.map((s) => {
        const b = btn(t('compare.restore', { name: nameOf(s) }), `＋ ${nameOf(s)}`, () => update({ order: slugs.filter((x) => state.order.includes(x) || x === s) }));
        b.className = 'btn small-btn';
        return b;
      }),
    );
    holder.hidden = hidden.length === 0;
  }

  function move(slug: string, delta: number) {
    const order = [...state.order];
    const i = order.indexOf(slug);
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    update({ order });
  }

  function renderScore() {
    const root = $('#score-root');
    if (!root) return;
    for (const input of root.querySelectorAll<HTMLInputElement>('input[data-weight]')) {
      input.value = String(state.weights[input.dataset.weight!] ?? 0);
      input.nextElementSibling!.textContent = input.value;
    }
    const order = state.order;
    const scores = computeScores(criteria, order, state.weights);
    $('#score-ranking')!.innerHTML = renderRanking(scores, criteria, state.weights, view);
    $('#score-radar')!.innerHTML = renderRadar(scores, criteria, state.weights, view);
    $('#score-winners')!.innerHTML = renderWinners(criteria, order, view);
  }

  function update(patch: Partial<UiState>) {
    state = { ...state, ...patch };
    if (state.pin && !state.order.includes(state.pin)) state.pin = null;
    const hash = serializeHash(state, slugs, defaults);
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    renderTable();
    renderScore();
  }

  $('#diff-toggle')!.addEventListener('change', (e) => update({ diff: (e.target as HTMLInputElement).checked }));
  for (const b of table.querySelectorAll<HTMLButtonElement>('.group-btn')) {
    b.addEventListener('click', () => {
      const key = b.dataset.toggle!;
      update({ collapsed: state.collapsed.includes(key) ? state.collapsed.filter((k) => k !== key) : [...state.collapsed, key] });
    });
  }
  for (const input of document.querySelectorAll<HTMLInputElement>('input[data-weight]')) {
    input.addEventListener('input', () => update({ weights: { ...state.weights, [input.dataset.weight!]: Number(input.value) } }));
  }
  $('#score-reset')?.addEventListener('click', () => update({ weights: { ...defaults } }));
  window.addEventListener('hashchange', () => {
    state = parseHash(location.hash, slugs, defaults);
    renderTable();
    renderScore();
  });

  renderTable();
  renderScore();
}
