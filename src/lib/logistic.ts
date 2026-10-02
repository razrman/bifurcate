export type View = { r0: number; r1: number; x0: number; x1: number };

export const HOME: View = { r0: 2.5, r1: 4, x0: 0, x1: 1 };

export function zoomView(view: View, fx: number, fy: number, factor: number): View {
  const rx = view.r0 + fx * (view.r1 - view.r0);
  const xx = view.x1 - fy * (view.x1 - view.x0);
  const dr = clamp((view.r1 - view.r0) * factor, 1e-7, 12);
  const dx = clamp((view.x1 - view.x0) * factor, 1e-7, 8);
  return {
    r0: rx - fx * dr,
    r1: rx + (1 - fx) * dr,
    x0: xx - (1 - fy) * dx,
    x1: xx + fy * dx,
  };
}

export function panView(view: View, dfx: number, dfy: number): View {
  const dr = view.r1 - view.r0;
  const dx = view.x1 - view.x0;
  return {
    r0: view.r0 - dfx * dr,
    r1: view.r1 - dfx * dr,
    x0: view.x0 + dfy * dx,
    x1: view.x1 + dfy * dx,
  };
}

export function niceStep(span: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const rough = span / 5;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const n = rough / pow;
  const f = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return f * pow;
}

export function formatTick(n: number): string {
  if (!Number.isFinite(n)) return "";
  const a = Math.abs(n);
  if (a !== 0 && (a < 0.001 || a >= 10000)) return n.toExponential(2);
  const digits = a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4;
  return String(Number(n.toFixed(digits)));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export type PlotBudget = { samples: number; skip: number; plot: number };

export function budgetFor(view: View): PlotBudget {
  const zoom = Math.max(1, 1.5 / Math.max(view.r1 - view.r0, 1e-9));
  const depth = Math.log2(zoom);
  return {
    samples: zoom > 6 ? 1 : 2,
    skip: Math.min(900, Math.round(160 + 50 * depth)),
    plot: Math.min(1400, Math.round(240 + 90 * depth)),
  };
}
