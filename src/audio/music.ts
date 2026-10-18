import { createRng } from '../core';
import { midiToHz, planBar, type Bar, type MusicMood } from './musicPlan';

/** Soft, slow music made on the spot (no recorded music, nothing to download): a pad, a bass, plucks and bells. */
export interface Music {
  setMood(mood: MusicMood): void;
  stop(): void;
}

/** How far ahead of the clock bars are written, and how often the scheduler looks. */
const LOOKAHEAD = 1.4;
const TICK_MS = 250;
const START_DELAY = 0.4;

/** A note: an oscillator through a gain envelope (fast attack, exponential release) into `out`. */
function voice(ctx: AudioContext, out: AudioNode, when: number, hz: number, seconds: number, type: OscillatorType, gain: number, attack: number, detune = 0): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = hz;
  osc.detune.value = detune;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(gain, when + attack);
  env.gain.setTargetAtTime(0.0001, when + Math.max(attack, seconds * 0.35), Math.max(seconds * 0.3, 0.05));
  osc.connect(env).connect(out);
  osc.start(when);
  osc.stop(when + seconds + 0.6);
}

/** Play one planned bar starting at `when`. */
function playBar(ctx: AudioContext, out: AudioNode, bar: Bar, mood: MusicMood, when: number): void {
  const beat = 60 / bar.tempo;
  const length = beat * 4;
  const warm = 0.55 + 0.45 * mood.day;
  // the pad: three soft voices a little out of tune with each other, swelling in and fading out over the bar
  const pad = ctx.createBiquadFilter();
  pad.type = 'lowpass';
  pad.frequency.value = 700 + 900 * warm;
  pad.connect(out);
  bar.chord.forEach((midi, i) => voice(ctx, pad, when, midiToHz(midi), length * 1.15, 'triangle', 0.05 * warm, 1.2, (i - 1) * 7));
  // the bass note on the first beat
  voice(ctx, out, when, midiToHz(bar.bass), beat * 3, 'sine', 0.13, 0.04);
  for (const n of bar.notes) {
    const t = when + n.beat * beat;
    const hz = midiToHz(n.midi);
    if (n.kind === 'bell') {
      voice(ctx, out, t, hz, beat * 3, 'sine', 0.05, 0.01);
      voice(ctx, out, t, hz * 2.76, beat * 1.2, 'sine', 0.012, 0.01); // the inharmonic partial that makes it a bell
    } else {
      voice(ctx, out, t, hz, beat * 0.9, 'triangle', 0.07, 0.01);
    }
  }
  // a low drum, as the sea gets rough
  for (const b of bar.drums) {
    const t = when + b * beat;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
    env.gain.setTargetAtTime(0.0001, t + 0.03, 0.12);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + 0.7);
  }
}

export function startMusic(ctx: AudioContext, out: AudioNode, seed = 0x5ea5): Music {
  let mood: MusicMood = { sea: 0.3, day: 1, docked: false };
  const rng = createRng(seed);
  let bar = 0;
  let next = ctx.currentTime + START_DELAY;
  const fill = (): void => {
    // A throttled timer (a hidden tab) can fall behind the clock: skip what was missed rather than play it all at once.
    if (next < ctx.currentTime) next = ctx.currentTime + START_DELAY;
    // Write bars until the next ones are further ahead than the lookahead; a paused context writes nothing.
    while (next < ctx.currentTime + LOOKAHEAD) {
      const planned = planBar(mood, bar++, rng);
      playBar(ctx, out, planned, mood, next);
      next += (60 / planned.tempo) * 4;
    }
  };
  fill();
  const timer = setInterval(fill, TICK_MS);
  return {
    setMood: (next) => (mood = next),
    stop: () => clearInterval(timer),
  };
}
