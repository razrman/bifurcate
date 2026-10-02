import type { View } from "@/lib/logistic";

const SCALE = [0, 3, 5, 7, 10];

export function orbitAt(r: number, view: View, count = 40): number[] {
  const pts: number[] = [];
  let x = 0.5;
  for (let i = 0; i < 160; i++) {
    x = r * x * (1 - x);
    if (!Number.isFinite(x) || x < -2 || x > 3) return pts;
  }
  for (let i = 0; i < count; i++) {
    x = r * x * (1 - x);
    if (!Number.isFinite(x) || x < -2 || x > 3) break;
    if (x > view.x0 && x < view.x1) pts.push(x);
  }
  return pts;
}

export function distinctDots(pts: number[], view: View): number[] {
  if (pts.length === 0) return [];
  const span = Math.abs(view.x1 - view.x0) || 1;
  const eps = Math.max(span * 0.006, 1e-5);
  const sorted = [...pts].sort((a, b) => a - b);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - out[out.length - 1] > eps) out.push(sorted[i]);
  }
  return out;
}

export function scatterDots(dots: number[], view: View, count: number): number[] {
  if (count <= 0 || dots.length === 0) return [];
  const span = Math.abs(view.x1 - view.x0) || 1;
  const order = dots.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }
  if (order.length <= count) return order;
  const chosen: number[] = [];
  let gap = span / (count + 1);
  while (chosen.length < count && gap > span * 0.012) {
    for (const x of order) {
      if (chosen.length >= count) break;
      if (chosen.some((picked) => Math.abs(picked - x) < gap)) continue;
      chosen.push(x);
    }
    gap *= 0.62;
  }
  return chosen;
}

export function slowFor(dots: number): number {
  return 1 + Math.log2(Math.max(1, dots)) * 0.75;
}

export function patternFor(slow: number, dots: number): { beats: number; perBeat: number } {
  const beats = dots <= 1 ? 1 : Math.max(1, Math.min(dots, Math.round(slow)));
  const perBeat = dots <= 0 ? 0 : Math.max(1, Math.min(3, Math.ceil(dots / beats)));
  return { beats, perBeat };
}

const KINDS = ["saw", "square", "tri", "bell", "organ", "fm"] as const;
type Kind = (typeof KINDS)[number];

export type VoiceBand = { kind: Kind; top: number; bottom: number };

export function randomBands(): VoiceBand[] {
  const kinds = [...KINDS].sort(() => Math.random() - 0.5);
  const min = 0.09;
  const extra = 1 - min * kinds.length;
  const weights = kinds.map(() => Math.random());
  const sum = weights.reduce((total, weight) => total + weight, 0);
  let y = 0;
  return kinds.map((kind, i) => {
    const top = y;
    y += min + (extra * weights[i]) / sum;
    return { kind, top, bottom: i === kinds.length - 1 ? 1 : y };
  });
}

export function bandAt(y: number, bands: VoiceBand[]): VoiceBand {
  const found = bands.find((band, i) => y >= band.top && (y < band.bottom || i === bands.length - 1));
  return found ?? bands[bands.length - 1];
}

function scaleSemi(index: number): number {
  const octave = Math.floor(index / SCALE.length);
  const scaleIndex = ((index % SCALE.length) + SCALE.length) % SCALE.length;
  return SCALE[scaleIndex] + octave * 12;
}

function degreeToSemi(degree: number): number {
  const base = Math.floor(degree);
  const frac = degree - base;
  return scaleSemi(base) * (1 - frac) + scaleSemi(base + 1) * frac;
}

function scaleNotesNear(semi: number): number[] {
  const octave = Math.floor(semi / 12);
  const notes: number[] = [];
  for (let oct = octave - 3; oct <= octave + 3; oct++) {
    for (const step of SCALE) notes.push(oct * 12 + step);
  }
  return notes;
}

function nearestScaleSemi(semi: number, low = -Infinity, high = Infinity): number {
  let best = scaleSemi(0);
  let bestDist = Infinity;
  for (const candidate of scaleNotesNear(semi)) {
    if (candidate < low - 1e-6 || candidate > high + 1e-6) continue;
    const dist = Math.abs(candidate - semi);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

function stepScale(semi: number, direction: -1 | 1): number {
  const notes = scaleNotesNear(semi).sort((a, b) => a - b);
  if (direction < 0) {
    const lower = notes.filter((note) => note < semi - 1e-6);
    return lower.length ? lower[lower.length - 1] : semi;
  }
  const higher = notes.filter((note) => note > semi + 1e-6);
  return higher.length ? higher[0] : semi;
}

export function freqFor(x: number, view: View, band?: { top: number; bottom: number }): number {
  const span = view.x1 - view.x0 || 1;
  const y = Math.min(1, Math.max(0, (x - view.x0) / span));
  const degrees = SCALE.length * 3 - 1;
  const semi = degreeToSemi(y * degrees);
  let played = nearestScaleSemi(semi);
  if (band) {
    const low = degreeToSemi(band.top * degrees);
    const high = degreeToSemi(Math.min(1, band.bottom) * degrees);
    const center = (low + high) / 2;
    const half = Math.max(0, high - low);
    let edgeLow = nearestScaleSemi(center - half);
    let edgeHigh = nearestScaleSemi(center + half);
    const target = Math.max(0, high - low) * 2;
    let guard = 0;
    while (edgeHigh - edgeLow + 0.25 < target && guard < 8) {
      if (center - edgeLow <= edgeHigh - center) edgeLow = stepScale(edgeLow, -1);
      else edgeHigh = stepScale(edgeHigh, 1);
      guard += 1;
    }
    const width = high - low || 1;
    const along = Math.min(1, Math.max(0, (semi - low) / width));
    played = nearestScaleSemi(edgeLow + along * (edgeHigh - edgeLow), edgeLow, edgeHigh);
  }
  const midi = 40 + played;
  return 440 * 2 ** ((midi - 69) / 12);
}

export type EdmTick = {
  progress: number;
  ys: number[];
  beats: number;
  bands: { top: number; bottom: number }[];
  done: boolean;
};

export class EdmEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer = 0;
  private step = 0;
  private running = false;
  private hatBuffer: AudioBuffer | null = null;
  private lastYs: number[] = [];
  private progress = 0;
  private smoothDots = 1;
  private bands: VoiceBand[] = [];
  onTick: ((tick: EdmTick) => void) | null = null;

  get active(): boolean {
    return this.running;
  }

  start(getView: () => View): void {
    this.stop();
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.34;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.12;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    const beatMs = (60 / 124 / 4) * 1000;
    this.step = 0;
    this.progress = 0;
    this.smoothDots = 1;
    this.bands = randomBands();
    this.lastYs = [];
    this.running = true;

    const pump = () => {
      if (!this.running || !this.ctx || !this.master) return;
      const when = this.ctx.currentTime + 0.05;
      const view = getView();
      const r = view.r0 + this.progress * (view.r1 - view.r0);
      const dots = distinctDots(orbitAt(r, view, 80), view);
      this.smoothDots = this.smoothDots * 0.8 + Math.max(1, dots.length) * 0.2;
      const slow = slowFor(this.smoothDots);
      const notes = patternFor(slow, dots.length).perBeat;
      const ys = this.hit(when, this.step, view, dots, notes);
      if (ys.length) this.lastYs = ys;
      this.step += 1;
      this.progress += 0.0045 / slow;
      if (this.progress >= 1) {
        this.progress = 0;
        this.smoothDots = 1;
        this.lastYs = [];
      }
      this.onTick?.({
        progress: this.progress,
        ys: this.lastYs,
        beats: Math.max(1, notes),
        bands: this.bandEdges(),
        done: false,
      });
      this.timer = window.setTimeout(pump, beatMs);
    };

    void ctx.resume();
    pump();
  }

  stop(): void {
    this.running = false;
    window.clearTimeout(this.timer);
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }

  private hit(when: number, step: number, view: View, dots: number[], notes: number): number[] {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return [];
    const beatSec = 60 / 124 / 4;
    const span = view.x1 - view.x0 || 1;
    const vel = notes > 0 ? 0.15 / Math.sqrt(notes) : 0;
    const ys: number[] = [];
    const seen = new Set<number>();
    const playlist = scatterDots(dots, view, Math.min(dots.length, notes));
    if (step % 4 === 0) this.kick(ctx, master, when);
    else if (step % 2 === 1) this.hat(ctx, master, when);
    for (const x of playlist) {
      const y = (view.x1 - x) / span;
      const key = Math.round(y * 1000);
      if (!seen.has(key)) {
        seen.add(key);
        ys.push(y);
      }
      const voice = bandAt(y, this.bands);
      this.tone(ctx, master, when, freqFor(x, view, voice), this.progress, vel, voice.kind, beatSec);
    }
    return ys;
  }

  private bandEdges(): { top: number; bottom: number }[] {
    return this.bands.map(({ top, bottom }) => ({ top, bottom }));
  }

  private tone(
    ctx: AudioContext,
    master: GainNode,
    when: number,
    freq: number,
    progress: number,
    vel: number,
    kind: Kind,
    beatSec: number,
  ): void {
    const dur = Math.min(kind === "bell" ? 0.12 : kind === "organ" ? 0.26 : 0.16, Math.max(0.06, beatSec * 0.9));
    const osc = ctx.createOscillator();
    osc.type = kind === "square" ? "square" : kind === "tri" || kind === "organ" ? "triangle" : kind === "saw" ? "sawtooth" : "sine";
    const played = kind === "bell" ? freq * 2 : freq;
    osc.frequency.setValueAtTime(played, when);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = kind === "bell" ? 0.7 : 5;
    const open = 700 + progress * 3800;
    filter.frequency.setValueAtTime(Math.min(7000, open * 1.3), when);
    filter.frequency.exponentialRampToValueAtTime(Math.max(200, open * 0.4), when + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(vel, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    const extras: OscillatorNode[] = [];
    if (kind === "saw" || kind === "square") {
      const ghost = ctx.createOscillator();
      ghost.type = osc.type;
      ghost.frequency.setValueAtTime(played * 1.006, when);
      ghost.connect(filter);
      extras.push(ghost);
    } else if (kind === "organ") {
      const fifth = ctx.createOscillator();
      fifth.type = "sine";
      fifth.frequency.setValueAtTime(played * 1.5, when);
      fifth.connect(filter);
      extras.push(fifth);
    } else if (kind === "fm") {
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      mod.frequency.setValueAtTime(played * 2, when);
      modGain.gain.setValueAtTime(played * 1.4, when);
      mod.connect(modGain);
      modGain.connect(osc.frequency);
      extras.push(mod);
    }

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + dur + 0.02);
    for (const extra of extras) {
      extra.start(when);
      extra.stop(when + dur + 0.02);
    }
  }

  private kick(ctx: AudioContext, master: GainNode, when: number): void {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(168, when);
    osc.frequency.exponentialRampToValueAtTime(46, when + 0.1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + 0.16);
  }

  private hat(ctx: AudioContext, master: GainNode, when: number): void {
    const n = Math.floor(ctx.sampleRate * 0.05);
    if (!this.hatBuffer) {
      this.hatBuffer = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = this.hatBuffer.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.hatBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "highpass";
    bp.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(master);
    src.start(when);
    src.stop(when + 0.05);
  }
}
