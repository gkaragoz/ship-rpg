import type { GameEvent } from '../core';
import { AUDIBLE, spatialMix, type Listener } from './mix';
import { cannon, hit, makeNoise, splash, sinking, startAmbience, type Ambience, type Bus } from './synth';

export interface Audio {
  /** Start the audio engine; browsers only allow it after a key press or click, so call it from one. */
  resume(): void;
  /** Play the sounds for this frame's events, positioned relative to `listener`. */
  play(events: readonly GameEvent[], listener: Listener): void;
  /** Set the wind and hull-water loudness. */
  ambience(wind: number, speed: number): void;
  /** Toggle mute; returns the new state. */
  toggleMute(): boolean;
  readonly muted: boolean;
  dispose(): void;
}

/** At most this many sounds are started per frame: a 24-gun broadside is one thunder, not 24 voices. */
const MAX_PER_FRAME = 10;
const MASTER = 0.55;

/**
 * Procedural sound. `makeContext` is injectable for tests; without Web Audio (or before
 * `resume()`) every call is a harmless no-op.
 */
export function createAudio(makeContext: () => AudioContext | null = () => (typeof AudioContext === 'undefined' ? null : new AudioContext())): Audio {
  let ctx: AudioContext | null = null;
  let bus: Bus | null = null;
  let master: GainNode | null = null;
  let panner: (() => StereoPannerNode) | null = null;
  let ambient: Ambience | null = null;
  let muted = false;
  let wind = 0;
  let speed = 0;

  const start = (): void => {
    if (ctx) {
      void ctx.resume();
      return;
    }
    ctx = makeContext();
    if (!ctx) return;
    const compressor = ctx.createDynamicsCompressor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    master.connect(compressor).connect(ctx.destination);
    bus = { ctx, noise: makeNoise(ctx) };
    const c = ctx;
    panner = () => c.createStereoPanner();
    ambient = startAmbience(bus, master);
    ambient.set(wind, speed);
  };

  return {
    resume: start,
    play(events, listener): void {
      if (!ctx || !bus || !master || !panner || muted) return;
      let started = 0;
      for (const e of events) {
        if (started >= MAX_PER_FRAME) break;
        const loud = e.type === 'sunk' ? 1 : e.type === 'fire' ? 1 : e.type === 'hit' ? 0.9 : 0.6;
        const mix = spatialMix(listener, e.x, e.z, loud);
        if (mix.gain < AUDIBLE) continue;
        const out = panner();
        out.pan.value = mix.pan;
        out.connect(master);
        // Muzzle events of one broadside arrive in a rolling spread, not on one tick.
        const when = ctx.currentTime + mix.delay + (e.type === 'fire' ? Math.random() * 0.18 : 0);
        if (e.type === 'fire') cannon(bus, out, when, mix.gain);
        else if (e.type === 'hit') hit(bus, out, when, mix.gain);
        else if (e.type === 'splash') splash(bus, out, when, mix.gain);
        else sinking(bus, out, when, mix.gain);
        started++;
      }
    },
    ambience(w, s): void {
      // Only touch the audio params when the conditions have really changed: this runs every frame.
      if (Math.abs(w - wind) < 0.2 && Math.abs(s - speed) < 0.2) return;
      wind = w;
      speed = s;
      ambient?.set(w, s);
    },
    toggleMute(): boolean {
      muted = !muted;
      master?.gain.setTargetAtTime(muted ? 0 : MASTER, ctx?.currentTime ?? 0, 0.05);
      return muted;
    },
    get muted(): boolean {
      return muted;
    },
    dispose(): void {
      ambient?.stop();
      ambient = null;
      const closing = ctx;
      ctx = null;
      bus = null;
      master = null;
      panner = null;
      if (closing) void closing.close();
    },
  };
}
