/** Geometry helpers for build-time SVG charts. No runtime, no dependency. */
export const W = 640;
export const H = 260;
export const M = { l: 48, r: 48, t: 14, b: 32 };
export const innerW = W - M.l - M.r;
export const innerH = H - M.t - M.b;

export const scaleLinear =
  ([d0, d1]: [number, number], [r0, r1]: [number, number]) =>
  (v: number) =>
    r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

/** Round axis bounds and ticks to 1, 2 or 5 x 10^n. */
export function niceTicks(min: number, max: number, count = 5): { min: number; max: number; ticks: number[] } {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min: lo, max: hi, ticks };
}

/** x of the centre of band i out of n. */
export const bandX = (i: number, n: number) => M.l + ((i + 0.5) * innerW) / n;
export const bandWidth = (n: number) => innerW / n;

type Num = number | null | undefined;

/** Polyline path that lifts the pen over missing values. */
export function linePath(values: Num[], x: (i: number) => number, y: (v: number) => number): string {
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** Filled band between two series; each run of complete points becomes one polygon. */
export function bandPath(lo: Num[], hi: Num[], x: (i: number) => number, y: (v: number) => number): string {
  let d = '';
  let start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    const up = [];
    const down = [];
    for (let i = start; i <= end; i++) {
      up.push(`${x(i).toFixed(1)} ${y(hi[i]!).toFixed(1)}`);
      down.unshift(`${x(i).toFixed(1)} ${y(lo[i]!).toFixed(1)}`);
    }
    d += `M${up.join('L')}L${down.join('L')}Z`;
    start = -1;
  };
  for (let i = 0; i < lo.length; i++) {
    if (lo[i] == null || hi[i] == null) close(i - 1);
    else if (start < 0) start = i;
  }
  close(lo.length - 1);
  return d;
}

/** Index range [first, last] of the stay days inside the chart window, or null. */
export function tripRange(days: string[], tripDays: string[]): [number, number] | null {
  const idx = tripDays.map((d) => days.indexOf(d)).filter((i) => i >= 0);
  return idx.length ? [Math.min(...idx), Math.max(...idx)] : null;
}

export const finite = (xs: Num[]): number[] => xs.filter((v): v is number => typeof v === 'number');
