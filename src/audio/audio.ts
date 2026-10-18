import type { Condition, GameEvent } from '../core';
import { conditionLayers, pristine, type ConditionLayers } from './condition';
import { startMusic, type Music } from './music';
import type { MusicMood } from './musicPlan';
import { AUDIBLE, spatialMix, type Listener } from './mix';
import { cannon, hit, makeNoise, riggingHit, splash, sinking, thunder, waterlineHit, startAmbience, type Ambience, type Bus } from './synth';

/** Loudness of each group of sounds, 0…1 (the settings' audio group). */
export interface Volumes {
  master: number;
  sfx: number;
  ambience: number;
  music: number;
  muted: boolean;
}

export const FULL_VOLUMES: Volumes = { master: 1, sfx: 1, ambience: 1, music: 1, muted: false };

export interface Audio {
  /** Start the audio engine; browsers only allow it after a key press or click, so call it from one. */
  resume(): void;
  /** Play the sounds for this frame's events, positioned relative to `listener`. */
  play(events: readonly GameEvent[], listener: Listener): void;
  /** The mood of the sea for the music (how rough, how light, in harbour or not); cheap to call every frame. */
  mood(mood: MusicMood): void;
  /** A lightning strike `distance` metres away: the crack arrives after the time sound needs, fainter the farther it is. */
  thunder(distance: number): void;
  /** Set the wind and hull-water loudness. */
  ambience(wind: number, speed: number): void;
  /** Set the damage ambience of the player's ship (creaks, sloshing water, fire crackle). Cheap to call every frame. */
  condition(c: Condition): void;
  /** Set the loudness of the groups and the mute state; may be called before `resume()`. */
  setVolumes(volumes: Volumes): void;
  /** Toggle mute; returns the new state. */
  toggleMute(): boolean;
  readonly muted: boolean;
  dispose(): void;
}

/** At most this many sounds are started per frame: a 24-gun broadside is one thunder, not 24 voices. */
const MAX_PER_FRAME = 10;
const MASTER = 0.55;

const CONDITION_STEP = 0.03;
const changed = (a: Condition, b: Condition): boolean =>
  Math.abs(a.rigging - b.rigging) > CONDITION_STEP || Math.abs(a.flooding - b.flooding) > CONDITION_STEP || Math.abs(a.fire - b.fire) > CONDITION_STEP;

/**
 * Procedural sound. `makeContext` is injectable for tests; without Web Audio (or before
 * `resume()`) every call is a harmless no-op.
 */
export function createAudio(makeContext: () => AudioContext | null = () => (typeof AudioContext === 'undefined' ? null : new AudioContext())): Audio {
  let ctx: AudioContext | null = null;
  let bus: Bus | null = null;
  let master: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let ambBus: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let music: Music | null = null;
  let mood: MusicMood = { sea: 0.3, day: 1, docked: false };
  let volumes: Volumes = { ...FULL_VOLUMES };
  let panner: (() => StereoPannerNode) | null = null;
  let ambient: Ambience | null = null;
  let muted = false;
  let wind = 0;
  let speed = 0;
  let cond: Condition = { rigging: 1, flooding: 0, fire: 0 };
  let layers: ConditionLayers | null = null;
  let layerCond: Condition | null = null;

  const start = (): void => {
    if (ctx) {
      void ctx.resume();
      return;
    }
    ctx = makeContext();
    if (!ctx) return;
    const compressor = ctx.createDynamicsCompressor();
    master = ctx.createGain();
    master.connect(compressor).connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    ambBus = ctx.createGain();
    ambBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.connect(master);
    musicBus.gain.value = volumes.music;
    master.gain.value = muted ? 0 : MASTER * volumes.master; // start at the set level, not at full, then ease as settings change
    sfxBus.gain.value = volumes.sfx;
    ambBus.gain.value = volumes.ambience;
    applyVolumes();
    bus = { ctx, noise: makeNoise(ctx) };
    const c = ctx;
    panner = () => c.createStereoPanner();
    ambient = startAmbience(bus, ambBus);
    music = startMusic(ctx, musicBus);
    music.setMood(mood);
    ambient.set(wind, speed);
    applyCondition();
  };

  /** Push the loudness settings to the gain nodes. */
  function applyVolumes(): void {
    if (!master || !sfxBus || !ambBus) return;
    const t = ctx?.currentTime ?? 0;
    master.gain.setTargetAtTime(muted ? 0 : MASTER * volumes.master, t, 0.05);
    sfxBus.gain.setTargetAtTime(volumes.sfx, t, 0.05);
    ambBus.gain.setTargetAtTime(volumes.ambience, t, 0.05);
    musicBus?.gain.setTargetAtTime(volumes.music, t, 0.1);
  }

  /** Starts the damage layers when something is damaged, retunes them on real change, stops them when pristine. */
  function applyCondition(): void {
    if (!bus || !ambBus) return;
    if (pristine(cond)) {
      layers?.stop();
      layers = null;
      layerCond = null;
      return;
    }
    layers ??= conditionLayers(bus, ambBus);
    if (layerCond && !changed(layerCond, cond)) return;
    layerCond = { ...cond };
    layers.set(cond);
  }

  return {
    resume: start,
    play(events, listener): void {
      if (!ctx || !bus || !sfxBus || !panner || muted) return;
      let started = 0;
      for (const e of events) {
        if (started >= MAX_PER_FRAME) break;
        if (e.type === 'escaped') continue; // nothing to hear: it simply sailed away
        const loud = e.type === 'sunk' ? 1 : e.type === 'fire' ? 1 : e.type === 'hit' ? 0.9 : 0.6;
        const mix = spatialMix(listener, e.x, e.z, loud);
        if (mix.gain < AUDIBLE) continue;
        const out = panner();
        out.pan.value = mix.pan;
        out.connect(sfxBus);
        // Muzzle events of one broadside arrive in a rolling spread, not on one tick.
        const when = ctx.currentTime + mix.delay + (e.type === 'fire' ? Math.random() * 0.18 : 0);
        if (e.type === 'fire') cannon(bus, out, when, mix.gain);
        else if (e.type === 'hit') (e.zone === 'rigging' ? riggingHit : e.zone === 'waterline' ? waterlineHit : hit)(bus, out, when, mix.gain);
        else if (e.type === 'splash') splash(bus, out, when, mix.gain);
        else sinking(bus, out, when, mix.gain);
        started++;
      }
    },
    mood(next): void {
      mood = next;
      music?.setMood(next);
    },
    thunder(distance): void {
      if (!ctx || !bus || !sfxBus || muted) return;
      thunder(bus, sfxBus, ctx.currentTime + Math.min(distance / 340, 9), 0.9 / (1 + distance / 900));
    },
    ambience(w, s): void {
      // Only touch the audio params when the conditions have really changed: this runs every frame.
      if (Math.abs(w - wind) < 0.2 && Math.abs(s - speed) < 0.2) return;
      wind = w;
      speed = s;
      ambient?.set(w, s);
    },
    condition(c): void {
      cond = c;
      applyCondition();
    },
    setVolumes(v): void {
      volumes = { ...v };
      muted = v.muted;
      applyVolumes();
    },
    toggleMute(): boolean {
      muted = !muted;
      applyVolumes();
      return muted;
    },
    get muted(): boolean {
      return muted;
    },
    dispose(): void {
      music?.stop();
      music = null;
      ambient?.stop();
      ambient = null;
      layers?.stop();
      layers = null;
      layerCond = null;
      const closing = ctx;
      ctx = null;
      bus = null;
      master = null;
      sfxBus = null;
      ambBus = null;
      musicBus = null;
      panner = null;
      if (closing) void closing.close();
    },
  };
}
