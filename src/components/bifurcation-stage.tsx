import { useEffect, useRef, useState, type ReactNode } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  HOME,
  budgetFor,
  formatTick,
  niceStep,
  panView,
  zoomView,
  type View,
} from "@/lib/logistic";
import { EdmEngine } from "@/lib/edm";

type Hover = { r: number; x: number } | null;

const BG = "#07090d";
const GRID = "rgba(232, 226, 214, 0.12)";
const LABEL = "rgba(141, 134, 120, 0.95)";

export function BifurcationStage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>(HOME);
  const [view, setView] = useState<View>(HOME);
  const [hover, setHover] = useState<Hover>(null);
  const [busy, setBusy] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [edmOn, setEdmOn] = useState(false);
  const [edmProgress, setEdmProgress] = useState(0);
  const [edmYs, setEdmYs] = useState<number[]>([]);
  const [edmBeats, setEdmBeats] = useState(1);
  const [edmBands, setEdmBands] = useState<{ top: number; bottom: number }[]>([]);
  const edmRef = useRef<EdmEngine | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  if (!edmRef.current) edmRef.current = new EdmEngine();

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let cancelled = false;
    let frame = 0;
    const showBusy = window.setTimeout(() => {
      if (!cancelled) setBusy(true);
    }, 140);

    const cssW = Math.max(1, wrap.clientWidth);
    const cssH = Math.max(1, wrap.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5, 1400 / cssW);
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    canvas.width = w;
    canvas.height = h;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    const counts = new Uint16Array(w * h);
    const { r0, r1, x0, x1 } = view;
    const dr = r1 - r0;
    const dx = x1 - x0;
    const { samples, skip, plot } = budgetFor(view);
    const colsPerFrame = 64;
    let px = 0;

    const step = () => {
      if (cancelled) return;
      const end = Math.min(w, px + colsPerFrame);
      for (let xPix = px; xPix < end; xPix++) {
        for (let s = 0; s < samples; s++) {
          const r = r0 + ((xPix + (s + 0.5) / samples) / w) * dr;
          let x = 0.5;
          let escaped = false;
          for (let i = 0; i < skip; i++) {
            x = r * x * (1 - x);
            if (x !== x || x < -2 || x > 3) {
              escaped = true;
              break;
            }
          }
          if (escaped) continue;
          for (let i = 0; i < plot; i++) {
            x = r * x * (1 - x);
            if (x !== x || x < -2 || x > 3) break;
            if (x <= x0 || x >= x1) continue;
            const yPix = (h - 1 - ((x - x0) / dx) * (h - 1)) | 0;
            if (yPix < 0 || yPix >= h) continue;
            const idx = yPix * w + xPix;
            const next = counts[idx] + 1;
            counts[idx] = next > 65535 ? 65535 : next;
          }
        }
      }
      paintStrip(ctx, counts, w, h, px, end, Math.log(1 + 72));
      px = end;
      if (px < w) {
        frame = requestAnimationFrame(step);
      } else {
        paintAll(ctx, counts, w, h);
        paintAxes(ctx, view, cssW, cssH, dpr);
        if (!cancelled) setBusy(false);
      }
    };

    frame = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(showBusy);
    };
  }, [view]);

  useEffect(() => {
    const engine = edmRef.current;
    return () => engine?.stop();
  }, []);

  const toggleEdm = () => {
    const engine = edmRef.current;
    if (!engine) return;
    if (engine.active) {
      engine.stop();
      setEdmOn(false);
      setEdmYs([]);
      setEdmBeats(1);
      setEdmBands([]);
      return;
    }
    engine.onTick = (tick) => {
      setEdmProgress(tick.progress);
      setEdmYs(tick.ys);
      setEdmBeats(tick.beats);
      setEdmBands(tick.bands);
      if (tick.done) setEdmOn(false);
    };
    engine.start(() => viewRef.current);
    setEdmOn(true);
    setEdmProgress(0);
    setEdmYs([]);
    setEdmBeats(1);
    setEdmBands([]);
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === sizeRef.current.w && h === sizeRef.current.h) return;
      sizeRef.current = { w, h };
      setView((v) => ({ ...v }));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let gesture:
      | {
          mode: "pan" | "pinch";
          start: View;
          x: number;
          y: number;
          dist: number;
          midX: number;
          midY: number;
          live: View;
        }
      | null = null;
    let wheelPending = viewRef.current;
    let wheelDirty = false;
    let wheelTimer = 0;

    const local = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, rect };
    };

    const clearPreview = () => {
      const canvas = canvasRef.current;
      if (canvas) canvas.style.transform = "";
    };

    const onDown = (e: PointerEvent) => {
      wrap.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, { x: p.x, y: p.y });
      setDragging(true);
      if (pointers.size === 1) {
        gesture = {
          mode: "pan",
          start: viewRef.current,
          x: p.x,
          y: p.y,
          dist: 0,
          midX: p.x,
          midY: p.y,
          live: viewRef.current,
        };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        gesture = {
          mode: "pinch",
          start: viewRef.current,
          x: 0,
          y: 0,
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2,
          live: viewRef.current,
        };
      }
    };

    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: p.x, y: p.y });
      const rect = p.rect;
      const canvas = canvasRef.current;
      if (!gesture) {
        const v = viewRef.current;
        setHover({
          r: v.r0 + (p.x / rect.width) * (v.r1 - v.r0),
          x: v.x1 - (p.y / rect.height) * (v.x1 - v.x0),
        });
        return;
      }
      if (gesture.mode === "pan" && pointers.size === 1) {
        const dx = p.x - gesture.x;
        const dy = p.y - gesture.y;
        gesture.live = panView(gesture.start, dx / rect.width, dy / rect.height);
        if (canvas) canvas.style.transform = `translate(${dx}px, ${dy}px)`;
        return;
      }
      if (gesture.mode === "pinch" && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.max(12, Math.hypot(a.x - b.x, a.y - b.y));
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const zoomed = zoomView(
          gesture.start,
          gesture.midX / rect.width,
          gesture.midY / rect.height,
          gesture.dist / dist,
        );
        gesture.live = panView(
          zoomed,
          (midX - gesture.midX) / rect.width,
          (midY - gesture.midY) / rect.height,
        );
        if (canvas) {
          canvas.style.transformOrigin = `${gesture.midX}px ${gesture.midY}px`;
          canvas.style.transform = `translate(${midX - gesture.midX}px, ${midY - gesture.midY}px) scale(${dist / gesture.dist})`;
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        if (gesture) {
          clearPreview();
          const next = gesture.live;
          const cur = viewRef.current;
          const moved =
            next.r0 !== cur.r0 || next.r1 !== cur.r1 || next.x0 !== cur.x0 || next.x1 !== cur.x1;
          if (moved) setView(next);
        }
        gesture = null;
        setDragging(false);
      } else if (pointers.size === 1) {
        const only = [...pointers.values()][0];
        const start = gesture?.live ?? viewRef.current;
        clearPreview();
        gesture = { mode: "pan", start, x: only.x, y: only.y, dist: 0, midX: only.x, midY: only.y, live: start };
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      const delta = e.ctrlKey ? e.deltaY * 0.01 : e.deltaY * 0.0014;
      const factor = Math.exp(Math.max(-0.55, Math.min(0.55, delta)));
      const base = wheelDirty ? wheelPending : viewRef.current;
      wheelPending = zoomView(base, fx, fy, factor);
      wheelDirty = true;
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        wheelDirty = false;
        setView(wheelPending);
      }, 70);
    };

    const onDbl = (e: MouseEvent) => {
      const rect = wrap.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      setView((v) => zoomView(v, fx, fy, 0.45));
    };

    const onLeave = () => setHover(null);

    wrap.addEventListener("pointerdown", onDown);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerup", onUp);
    wrap.addEventListener("pointercancel", onUp);
    wrap.addEventListener("wheel", onWheel, { passive: false });
    wrap.addEventListener("dblclick", onDbl);
    wrap.addEventListener("pointerleave", onLeave);
    return () => {
      wrap.removeEventListener("pointerdown", onDown);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerup", onUp);
      wrap.removeEventListener("pointercancel", onUp);
      wrap.removeEventListener("wheel", onWheel);
      wrap.removeEventListener("dblclick", onDbl);
      wrap.removeEventListener("pointerleave", onLeave);
      window.clearTimeout(wheelTimer);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const pan = 0.08;
      if (e.key === "ArrowLeft") setView((v) => panView(v, pan, 0));
      else if (e.key === "ArrowRight") setView((v) => panView(v, -pan, 0));
      else if (e.key === "ArrowUp") setView((v) => panView(v, 0, pan));
      else if (e.key === "ArrowDown") setView((v) => panView(v, 0, -pan));
      else if (e.key === "+" || e.key === "=") setView((v) => zoomView(v, 0.5, 0.5, 0.7));
      else if (e.key === "-" || e.key === "_") setView((v) => zoomView(v, 0.5, 0.5, 1 / 0.7));
      else if (e.key === "0") setView(HOME);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section className="flex h-dvh min-h-0 flex-col bg-bg text-fg">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-balance text-base font-semibold tracking-tight">Bifurcate</h1>
          <p className="font-mono text-sm text-accent">x′ = r x (1 − x)</p>
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-muted">
          <div>
            <dt className="inline">r </dt>
            <dd className="inline text-fg">
              {formatTick(view.r0)} – {formatTick(view.r1)}
            </dd>
          </div>
          <div>
            <dt className="inline">x </dt>
            <dd className="inline text-fg">
              {formatTick(view.x0)} – {formatTick(view.x1)}
            </dd>
          </div>
        </dl>
        <div className="ml-auto flex items-center gap-2">
          <IconButton label="Zoom out" onClick={() => setView((v) => zoomView(v, 0.5, 0.5, 1 / 0.7))}>
            <Minus className="size-4" />
          </IconButton>
          <IconButton label="Zoom in" onClick={() => setView((v) => zoomView(v, 0.5, 0.5, 0.7))}>
            <Plus className="size-4" />
          </IconButton>
          <button
            type="button"
            onClick={toggleEdm}
            aria-pressed={edmOn}
            className={`inline-flex h-11 items-center rounded-md border px-3 text-sm font-medium ${
              edmOn ? "border-accent text-accent" : "border-line bg-surface text-fg"
            }`}
          >
            EDM
          </button>
          <button
            type="button"
            onClick={() => setView(HOME)}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm text-fg"
          >
            <RotateCcw className="size-4" />
            Reset
          </button>
        </div>
      </header>

      <div
        ref={wrapRef}
        className={`relative min-h-0 flex-1 touch-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {edmOn ? (
          <div
            className="pointer-events-none absolute inset-0"
            data-edm-progress={edmProgress.toFixed(4)}
            data-edm-beats={edmBeats}
            data-edm-bands={edmBands.length}
          >
            {edmBands.slice(0, -1).map((band) => (
              <div
                key={band.bottom}
                className="edm-band absolute inset-x-0 h-px bg-accent/50"
                style={{ top: `${band.bottom * 100}%` }}
              />
            ))}
            <div
              className="absolute inset-y-0 w-px bg-accent"
              style={{ left: `${edmProgress * 100}%` }}
            />
            {edmYs.map((y, i) => (
              <span
                key={i}
                className="absolute size-2 -translate-x-1 -translate-y-1 rounded-full bg-accent"
                style={{ left: `${edmProgress * 100}%`, top: `${y * 100}%` }}
              />
            ))}
          </div>
        ) : null}
        {busy ? (
          <p className="pointer-events-none absolute left-4 top-3 font-mono text-xs text-muted">Plotting…</p>
        ) : null}
        {hover ? (
          <p className="pointer-events-none absolute bottom-3 left-3 font-mono text-xs tabular-nums text-fg">
            r {formatTick(hover.r)} · x {formatTick(hover.x)}
          </p>
        ) : null}
      </div>

      <footer className="border-t border-line px-4 py-2 text-xs text-muted">
        Scroll or pinch to zoom · drag to pan · double-click to zoom in · arrows and +/− · EDM plays the sweep 
      </footer>
    </section>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-11 items-center justify-center rounded-md border border-line bg-surface text-fg"
    >
      {children}
    </button>
  );
}

function paintStrip(
  ctx: CanvasRenderingContext2D,
  counts: Uint16Array,
  w: number,
  h: number,
  from: number,
  to: number,
  logMax: number,
) {
  const span = to - from;
  if (span <= 0) return;
  const strip = ctx.createImageData(span, h);
  writeColumns(strip.data, counts, w, h, from, to, span, logMax);
  ctx.putImageData(strip, from, 0);
}

function paintAll(ctx: CanvasRenderingContext2D, counts: Uint16Array, w: number, h: number) {
  let max = 1;
  for (let i = 0; i < counts.length; i++) if (counts[i] > max) max = counts[i];
  const logMax = Math.log(1 + max);
  const rows = 80;
  for (let y0 = 0; y0 < h; y0 += rows) {
    const y1 = Math.min(h, y0 + rows);
    const strip = ctx.createImageData(w, y1 - y0);
    const data = strip.data;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        const c = counts[y * w + x];
        const o = ((y - y0) * w + x) * 4;
        writePixel(data, o, c, logMax);
      }
    }
    ctx.putImageData(strip, 0, y0);
  }
}

function writeColumns(
  data: Uint8ClampedArray,
  counts: Uint16Array,
  w: number,
  h: number,
  from: number,
  to: number,
  span: number,
  logMax: number,
) {
  for (let y = 0; y < h; y++) {
    for (let x = from; x < to; x++) {
      const o = (y * span + (x - from)) * 4;
      writePixel(data, o, counts[y * w + x], logMax);
    }
  }
}

function writePixel(data: Uint8ClampedArray, o: number, c: number, logMax: number) {
  if (c === 0) {
    data[o] = 7;
    data[o + 1] = 9;
    data[o + 2] = 13;
    data[o + 3] = 255;
    return;
  }
  const t = Math.min(1, Math.log(1 + c) / logMax);
  const u = t ** 0.7;
  data[o] = (36 + 219 * u) | 0;
  data[o + 1] = (24 + 190 * t ** 0.88) | 0;
  data[o + 2] = (12 + 140 * t ** 1.35) | 0;
  data[o + 3] = 255;
}

function paintAxes(
  ctx: CanvasRenderingContext2D,
  view: View,
  cssW: number,
  cssH: number,
  dpr: number,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = GRID;
  ctx.fillStyle = LABEL;
  ctx.lineWidth = 1;
  ctx.font = "12px IBM Plex Mono, ui-monospace, monospace";
  const rStep = niceStep(view.r1 - view.r0);
  const xStep = niceStep(view.x1 - view.x0);
  ctx.beginPath();
  for (let r = Math.ceil(view.r0 / rStep) * rStep; r < view.r1; r += rStep) {
    const x = ((r - view.r0) / (view.r1 - view.r0)) * cssW;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cssH);
    ctx.fillText(formatTick(r), x + 4, cssH - 8);
  }
  for (let x = Math.ceil(view.x0 / xStep) * xStep; x < view.x1; x += xStep) {
    const y = (1 - (x - view.x0) / (view.x1 - view.x0)) * cssH;
    ctx.moveTo(0, y);
    ctx.lineTo(cssW, y);
    ctx.fillText(formatTick(x), 8, Math.max(14, y - 4));
  }
  ctx.stroke();
}
