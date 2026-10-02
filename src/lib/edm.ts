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

const INSTRUMENTS = ["flute", "space", "violin", "guitar", "slap", "bass"] as const;
type Kind = (typeof INSTRUMENTS)[number];
type SampleKind = Exclude<Kind, "space" | "violin" | "guitar" | "slap" | "bass">;

const SAMPLE_BASE: Record<SampleKind, number> = {
  flute: 440,
};

function rateFor(kind: SampleKind, freq: number): number {
  const rate = freq / SAMPLE_BASE[kind];
  return Math.min(4, Math.max(0.2, rate));
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
  private drums: GainNode | null = null;
  private timer = 0;
  private step = 0;
  private running = false;
  private hatBuffer: AudioBuffer | null = null;
  private samples: Partial<Record<SampleKind, AudioBuffer>> = {};
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
    const drums = ctx.createGain();
    drums.gain.value = 0.08;
    drums.connect(master);
    this.drums = drums;
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
    this.drums = null;
    this.samples = {};
    if (ctx && ctx.state !== "closed") void ctx.close();
  }

  private hit(when: number, step: number, view: View, dots: number[], notes: number): number[] {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return [];
    const beatSec = 60 / 124 / 4;
    const span = view.x1 - view.x0 || 1;
    const vel = notes > 0 ? 0.28 / Math.sqrt(notes) : 0;
    const ys: number[] = [];
    const seen = new Set<number>();
    const playlist = scatterDots(dots, view, Math.min(dots.length, notes));
    const drums = this.drums ?? master;
    if (step % 4 === 0) this.kick(ctx, drums, when);
    else if (step % 2 === 1) this.hat(ctx, drums, when);
    for (const x of playlist) {
      const y = (view.x1 - x) / span;
      const key = Math.round(y * 1000);
      if (!seen.has(key)) {
        seen.add(key);
        ys.push(y);
      }
      const voice = bandAt(y, this.bands).kind;
      const freq = freqFor(x, view);
      if (voice === "space" || voice === "violin") this.playStaccato(ctx, master, when, freq, vel, voice);
      else if (voice === "guitar") this.playOsc(ctx, master, when, freq, vel, beatSec, "sine");
      else if (voice === "slap") this.playOsc(ctx, master, when, freq, vel, beatSec, "square");
      else if (voice === "bass") this.playBass(ctx, master, when, freq, vel);
      else this.playSample(ctx, master, when, freq, vel, voice, beatSec);
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
    kind: SampleKind,
    beatSec: number,
  ): void {
    const buffer = this.samples[kind];
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.setValueAtTime(rateFor(kind, freq), when);
    const gain = ctx.createGain();
    const hold = Math.max(0.22, beatSec * 0.95);
    gain.gain.setValueAtTime(Math.max(0.0001, vel * 12), when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + hold);
    src.connect(gain);
    gain.connect(master);
    src.start(when);
    src.stop(when + hold + 0.02);
  }

  private playOsc(
    ctx: AudioContext,
    master: GainNode,
    when: number,
    freq: number,
    vel: number,
    beatSec: number,
    type: "sine" | "square",
  ): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    const gain = ctx.createGain();
    const dur = type === "square" ? Math.max(0.05, Math.min(0.12, beatSec * 0.7)) : Math.max(0.08, Math.min(0.22, beatSec * 0.9));
    const level = Math.max(0.04, vel * (type === "square" ? 1.6 : 3));
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(level, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  private playBass(ctx: AudioContext, master: GainNode, when: number, freq: number, vel: number): void {
    const note = Math.max(32, freq / 2);
    const dur = 0.26;
    const level = Math.max(0.06, vel * 3.2);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.setValueAtTime(14, when);
    filter.frequency.setValueAtTime(Math.min(4200, note * 12), when);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, note * 1.6), when + dur);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, when);
    out.gain.exponentialRampToValueAtTime(level, when + 0.012);
    out.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    filter.connect(out);
    out.connect(master);

    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(note * 1.5, when);
    sub.frequency.exponentialRampToValueAtTime(note, when + 0.06);
    const subGain = ctx.createGain();
    subGain.gain.value = 0.85;
    sub.connect(subGain);
    subGain.connect(out);
    sub.start(when);
    sub.stop(when + dur + 0.02);

    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(note * 1.5, when);
    saw.frequency.exponentialRampToValueAtTime(note, when + 0.06);
    const sawGain = ctx.createGain();
    sawGain.gain.value = 0.28;
    saw.connect(sawGain);
    sawGain.connect(filter);
    saw.start(when);
    saw.stop(when + dur + 0.02);
  }

  private playStaccato(
    ctx: AudioContext,
    master: GainNode,
    when: number,
    freq: number,
    vel: number,
    kind: "space" | "violin",
  ): void {
    if (kind === "violin") {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, when);
      const gain = ctx.createGain();
      const level = Math.max(0.04, vel * 1.6);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(level, when + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.055);
      osc.connect(gain);
      gain.connect(master);
      osc.start(when);
      osc.stop(when + 0.07);
      return;
    }
    const dur = 0.07;
    const level = Math.max(0.05, vel * 3.2);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 7;
    const open = Math.min(6400, freq * 7);
    filter.frequency.setValueAtTime(open, when);
    filter.frequency.exponentialRampToValueAtTime(Math.max(180, open * 0.35), when + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(level, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    filter.connect(gain);
    gain.connect(master);
    const specs = [
      { type: "sawtooth" as OscillatorType, ratio: 1, detune: -14, mix: 0.34 },
      { type: "sawtooth" as OscillatorType, ratio: 1, detune: 14, mix: 0.34 },
      { type: "triangle" as OscillatorType, ratio: 2, detune: 0, mix: 0.16 },
    ];
    for (const spec of specs) {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(freq * spec.ratio, when);
      osc.detune.setValueAtTime(spec.detune, when);
      const mix = ctx.createGain();
      mix.gain.value = spec.mix;
      osc.connect(mix);
      mix.connect(filter);
      osc.start(when);
      osc.stop(when + dur + 0.02);
    }
  }

  private buildSamples(ctx: AudioContext): Record<SampleKind, AudioBuffer> {
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
      flute: render(0.55, (t) => {
        const attack = Math.min(1, t / 0.07);
        const env = attack * Math.exp(-t * 1.4);
        const vib = Math.sin(2 * Math.PI * 5 * t) * 0.012;
        const tone = Math.sin(2 * Math.PI * 440 * t * (1 + vib)) + 0.12 * Math.sin(2 * Math.PI * 880 * t);
        const breath = (rand() * 2 - 1) * 0.05;
        return (tone + breath) * env;
      }),
    };
  }

  private kick(ctx: AudioContext, master: GainNode, when: number): void {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(78, when);
    osc.frequency.exponentialRampToValueAtTime(36, when + 0.08);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.025, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + 0.16);

    const click = ctx.createOscillator();
    click.type = "sine";
    click.frequency.setValueAtTime(150, when);
    click.frequency.exponentialRampToValueAtTime(50, when + 0.03);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.006, when);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    click.connect(clickGain);
    clickGain.connect(master);
    click.start(when);
    click.stop(when + 0.05);
  }

  private hat(ctx: AudioContext, master: GainNode, when: number): void {
    const n = Math.floor(ctx.sampleRate * 0.08);
    if (!this.hatBuffer || this.hatBuffer.length !== n) {
      this.hatBuffer = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = this.hatBuffer.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.hatBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.005, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(master);
    src.start(when);
    src.stop(when + 0.08);
  }
}
