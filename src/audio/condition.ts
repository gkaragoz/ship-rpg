import type { Condition } from '../core';
import { clamp } from '../core';
import type { Bus } from './synth';

/** Loudness caps of the damage layers (the master bus and compressor sit after them). */
const CREAK_MAX = 0.12;
const SLOSH_MAX = 0.14;
const CRACKLE_MAX = 0.2;
/** Crackle ticks per second at fire 0+ and at fire 1; the looped tick buffer holds TICKS_PER_LOOP. */
const TICKS_MIN = 4;
const TICKS_MAX = 24;
const TICKS_PER_LOOP = 16;

/** True when nothing is damaged: every layer is silent. */
export const pristine = (c: Condition): boolean => c.rigging >= 1 && c.flooding <= 0 && c.fire <= 0;

/** Timber groan: grows as the rigging falls and as the hull floods. 0 when pristine, capped. */
export function creakGain(rigging: number, flooding: number): number {
  return CREAK_MAX * clamp(0.6 * (1 - clamp(rigging, 0, 1)) + 0.5 * clamp(flooding, 0, 1), 0, 1);
}

/** Water sloshing in the hold: grows with flooding. */
export function sloshGain(flooding: number): number {
  return SLOSH_MAX * clamp(flooding, 0, 1) ** 1.2;
}

/** Crackle ticks per second: 0 without fire, denser as it spreads. */
export function crackleDensity(fire: number): number {
  const f = clamp(fire, 0, 1);
  return f <= 0 ? 0 : TICKS_MIN + (TICKS_MAX - TICKS_MIN) * f;
}

/** Crackle loudness: grows with fire. */
export function crackleGain(fire: number): number {
  return CRACKLE_MAX * clamp(fire, 0, 1);
}

export interface ConditionLayers {
  set(c: Condition): void;
  stop(): void;
}

/** A loop of sparse, sharp, randomly spaced ticks; playback rate scales their density. */
function tickBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 2)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const decay = Math.max(1, Math.floor(ctx.sampleRate * 0.012));
  for (let t = 0; t < TICKS_PER_LOOP; t++) {
    const at = Math.floor(Math.random() * data.length);
    const amp = 0.4 + Math.random() * 0.6;
    for (let i = 0; i < decay * 4 && at + i < data.length; i++) data[at + i] = (data[at + i] ?? 0) + (Math.random() * 2 - 1) * amp * Math.exp(-i / decay);
  }
  return buffer;
}

/**
 * Looping damage layers for the player's ship: timber creak, water slosh, fire crackle.
 * They start silent; `set` moves their gains (call it only on real change).
 */
export function conditionLayers(bus: Bus, out: AudioNode): ConditionLayers {
  const { ctx } = bus;
  const t = (): number => ctx.currentTime;
  const sources: Array<AudioScheduledSourceNode> = [];
  const gains: GainNode[] = [];
  const silentGain = (): GainNode => {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(out);
    gains.push(g);
    return g;
  };
  const lfo = (rate: number, depth: number, target: AudioParam): void => {
    const osc = ctx.createOscillator();
    osc.frequency.value = rate;
    const amount = ctx.createGain();
    amount.gain.value = depth;
    osc.connect(amount).connect(target);
    osc.start();
    sources.push(osc);
  };

  // Creak: a low saw through a lowpass, its loudness swelling slowly (hull working in the swell).
  const creak = silentGain();
  const creakOsc = ctx.createOscillator();
  creakOsc.type = 'sawtooth';
  creakOsc.frequency.value = 58;
  const creakFilter = ctx.createBiquadFilter();
  creakFilter.type = 'lowpass';
  creakFilter.frequency.value = 240;
  const creakSwell = ctx.createGain();
  creakSwell.gain.value = 0.6;
  creakOsc.connect(creakFilter).connect(creakSwell).connect(creak);
  creakOsc.start();
  sources.push(creakOsc);
  lfo(0.23, 0.4, creakSwell.gain);
  lfo(0.07, 6, creakOsc.frequency);

  // Slosh: filtered noise whose cutoff rolls slowly like water in the hold.
  const slosh = silentGain();
  const sloshSrc = ctx.createBufferSource();
  sloshSrc.buffer = bus.noise;
  sloshSrc.loop = true;
  const sloshFilter = ctx.createBiquadFilter();
  sloshFilter.type = 'lowpass';
  sloshFilter.frequency.value = 420;
  sloshSrc.connect(sloshFilter).connect(slosh);
  sloshSrc.start(0, Math.random() * 1.5);
  sources.push(sloshSrc);
  lfo(0.35, 260, sloshFilter.frequency);

  // Crackle: a looped tick buffer, highpassed; the playback rate sets how dense the ticks are.
  const crackle = silentGain();
  const crackleSrc = ctx.createBufferSource();
  crackleSrc.buffer = tickBuffer(ctx);
  crackleSrc.loop = true;
  const crackleFilter = ctx.createBiquadFilter();
  crackleFilter.type = 'highpass';
  crackleFilter.frequency.value = 1800;
  crackleSrc.connect(crackleFilter).connect(crackle);
  crackleSrc.start(0, Math.random());
  sources.push(crackleSrc);

  return {
    set(c): void {
      creak.gain.setTargetAtTime(creakGain(c.rigging, c.flooding), t(), 0.8);
      slosh.gain.setTargetAtTime(sloshGain(c.flooding), t(), 0.8);
      crackle.gain.setTargetAtTime(crackleGain(c.fire), t(), 0.4);
      crackleSrc.playbackRate.setTargetAtTime(crackleDensity(c.fire) / TICKS_PER_LOOP * 2 || 1, t(), 0.4);
    },
    stop(): void {
      for (const g of gains) g.gain.setTargetAtTime(0, t(), 0.2);
      for (const s of sources) s.stop(t() + 1.5);
    },
  };
}
