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

const INSTRUMENTS = ["cymbal", "flute", "woodblock", "guitar", "tom", "slap", "bass"] as const;
type Kind = (typeof INSTRUMENTS)[number];

const SAMPLE_BASE: Record<Kind, number> = {
  cymbal: 1,
  flute: 440,
  woodblock: 740,
  guitar: 220,
  tom: 110,
  slap: 82,
  bass: 55,
};

function rateFor(kind: Kind, freq: number): number {
  if (kind === "cymbal") return Math.min(1.45, Math.max(0.75, 0.85 + freq / 1400));
  const rate = freq / SAMPLE_BASE[kind];
  if (kind === "woodblock") return Math.min(1.7, Math.max(0.7, rate));
  if (kind === "tom") return Math.min(2.2, Math.max(0.45, rate));
  return Math.min(4, Math.max(0.25, rate));
}

export type VoiceBand = { kind: Kind; top: number; bottom: number };

export function randomBands(): VoiceBand[] {
  const min = 0.08;
  const extra = 1 - min * INSTRUMENTS.length;
  const weights = INSTRUMENTS.map(() => Math.random());
  const sum = weights.reduce((total, weight) => total + weight, 0);
  let y = 0;
  return INSTRUMENTS.map((kind, i) => {
    const top = y;
    y += min + (extra * weights[i]) / sum;
    return { kind, top, bottom: i === INSTRUMENTS.length - 1 ? 1 : y };
  });
}

export function bandAt(y: number, bands: VoiceBand[]): VoiceBand {
  const found = bands.find((band, i) => y >= band.top && (y < band.bottom || i === bands.length - 1));
  return found ?? bands[bands.length - 1];
}

export function freqFor(x: number, view: View): number {
  const span = view.x1 - view.x0 || 1;
  const y = Math.min(1, Math.max(0, (x - view.x0) / span));
  const degrees = SCALE.length * 3;
  const idx = Math.round(y * (degrees - 1));
  const semi = SCALE[idx % SCALE.length] + Math.floor(idx / SCALE.length) * 12;
  const midi = 40 + semi;
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
  private samples: Partial<Record<Kind, AudioBuffer>> = {};
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
    this.samples = this.buildSamples(ctx);

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
      const voice = bandAt(y, this.bands).kind;
      this.playSample(ctx, master, when, freqFor(x, view), vel, voice, beatSec);
    }
    return ys;
  }

  private bandEdges(): { top: number; bottom: number }[] {
    return this.bands.map(({ top, bottom }) => ({ top, bottom }));
  }

  private playSample(
    ctx: AudioContext,
    master: GainNode,
    when: number,
    freq: number,
    vel: number,
    kind: Kind,
    beatSec: number,
  ): void {
    const buffer = this.samples[kind];
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.setValueAtTime(rateFor(kind, freq), when);
    const gain = ctx.createGain();
    const hold =
      kind === "cymbal" || kind === "flute" || kind === "guitar"
        ? Math.max(0.22, beatSec * 0.95)
        : Math.max(0.05, Math.min(buffer.duration, beatSec * 0.9));
    gain.gain.setValueAtTime(Math.max(0.0001, vel * 2.4), when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + hold);
    src.connect(gain);
    gain.connect(master);
    src.start(when);
    src.stop(when + hold + 0.02);
  }

  private buildSamples(ctx: AudioContext): Record<Kind, AudioBuffer> {
    const sr = ctx.sampleRate;
    const render = (seconds: number, fill: (t: number) => number) => {
      const length = Math.max(1, Math.floor(sr * seconds));
      const buffer = ctx.createBuffer(1, length, sr);
      const data = buffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < length; i++) {
        const sample = fill(i / sr);
        data[i] = sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      const gain = peak > 0 ? 0.85 / peak : 1;
      for (let i = 0; i < length; i++) data[i] *= gain;
      return buffer;
    };
    let noise = 0.2;
    const rand = () => {
      noise = (noise * 16807) % 2147483647;
      return noise / 2147483647;
    };
    return {
      guitar: render(0.46, (t) => {
        const env = Math.exp(-t * 5.5) * (1 - Math.exp(-t * 90));
        let sum = 0;
        for (let h = 1; h <= 7; h++) sum += Math.sin(2 * Math.PI * 220 * h * t) / h;
        return Math.tanh(sum * 1.6) * env;
      }),
      bass: render(0.42, (t) => {
        const env = Math.exp(-t * 3.2) * (1 - Math.exp(-t * 120));
        const body =
          Math.sin(2 * Math.PI * 55 * t) +
          0.28 * Math.sin(2 * Math.PI * 110 * t) +
          0.06 * Math.sin(2 * Math.PI * 165 * t);
        return body * env;
      }),
      slap: render(0.24, (t) => {
        const click = (rand() * 2 - 1) * Math.exp(-t * 90);
        const pop = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 28);
        const body = Math.sin(2 * Math.PI * 82 * t) * Math.exp(-t * 10);
        return click * 0.7 + pop * 0.45 + body;
      }),
      flute: render(0.55, (t) => {
        const attack = Math.min(1, t / 0.07);
        const env = attack * Math.exp(-t * 1.4);
        const vib = Math.sin(2 * Math.PI * 5 * t) * 0.012;
        const tone = Math.sin(2 * Math.PI * 440 * t * (1 + vib)) + 0.12 * Math.sin(2 * Math.PI * 880 * t);
        const breath = (rand() * 2 - 1) * 0.05;
        return (tone + breath) * env;
      }),
      cymbal: render(0.7, (t) => {
        const partials = [317, 463, 733, 1049, 1481, 2099, 2711, 3541];
        let sum = 0;
        for (const hz of partials) sum += Math.sin(2 * Math.PI * hz * t) * Math.exp(-t * (1.6 + hz / 900));
        const wash = (rand() * 2 - 1) * Math.exp(-t * 3.2);
        return sum * 0.18 + wash * 0.35;
      }),
      tom: render(0.36, (t) => {
        const phase = 2 * Math.PI * (90 * t + (140 / 16) * (1 - Math.exp(-t * 16)));
        return Math.sin(phase) * Math.exp(-t * 6.5);
      }),
      woodblock: render(0.09, (t) => {
        const knock = Math.sin(2 * Math.PI * 740 * t) * Math.exp(-t * 36);
        const tick = Math.sin(2 * Math.PI * 1680 * t) * Math.exp(-t * 70);
        return knock + tick * 0.35;
      }),
    };
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
