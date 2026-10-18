import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core';
import { REFERENCE_DISTANCE, SPEED_OF_SOUND, createAudio, spatialMix } from '../src/audio';
import { crackleDensity, crackleGain, creakGain, sloshGain } from '../src/audio/condition';

const ear = { x: 0, z: 0, heading: 0 }; // facing east: starboard is +z (south), port is -z (north)

describe('spatialMix', () => {
  it('is full loudness, centred and instant at the listener', () => {
    const m = spatialMix(ear, 0, 0);
    expect(m.gain).toBe(1);
    expect(m.pan).toBe(0);
    expect(m.delay).toBe(0);
  });

  it('is half loudness at the reference distance and keeps falling', () => {
    expect(spatialMix(ear, REFERENCE_DISTANCE, 0).gain).toBeCloseTo(0.5, 5);
    expect(spatialMix(ear, 4 * REFERENCE_DISTANCE, 0).gain).toBeLessThan(0.15);
    expect(spatialMix(ear, 50, 0).gain).toBeGreaterThan(spatialMix(ear, 100, 0).gain);
  });

  it('delays a sound by its travel time at the speed of sound, up to a cap', () => {
    expect(spatialMix(ear, SPEED_OF_SOUND, 0).delay).toBeCloseTo(1, 5);
    expect(spatialMix(ear, 100000, 0).delay).toBeLessThanOrEqual(2.5);
  });

  it('pans to the side the sound is on, from the listener heading', () => {
    expect(spatialMix(ear, 0, 100).pan).toBeCloseTo(1, 5); // east-facing: south is starboard
    expect(spatialMix(ear, 0, -100).pan).toBeCloseTo(-1, 5);
    expect(Math.abs(spatialMix(ear, 100, 0).pan)).toBeLessThan(1e-9); // dead ahead
    expect(Math.abs(spatialMix(ear, -100, 0).pan)).toBeLessThan(1e-9); // dead astern
    // Facing north (heading π/2), starboard is east (+x).
    expect(spatialMix({ x: 0, z: 0, heading: Math.PI / 2 }, 100, 0).pan).toBeCloseTo(1, 5);
  });

  it('scales with the requested loudness and stays within 0…1', () => {
    expect(spatialMix(ear, 60, 0, 0.5).gain).toBeCloseTo(spatialMix(ear, 60, 0, 1).gain / 2, 5);
    expect(spatialMix(ear, 0, 0, 5).gain).toBe(1);
  });
});

/** A minimal Web Audio stand-in that counts the sound sources started. */
interface Started {
  when: number;
  offset?: number;
  duration?: number;
  loop: boolean;
}

function fakeContext(): { ctx: AudioContext; sources: () => number; closed: () => boolean; started: Started[]; targets: () => number } {
  let sources = 0;
  let targets = 0;
  const started: Started[] = [];
  let closed = false;
  const param = (): object => ({
    value: 0,
    setValueAtTime(): void {},
    exponentialRampToValueAtTime(): void {},
    setTargetAtTime(): void {
      targets++;
    },
  });
  const node = (extra: object = {}): object => {
    const n: Record<string, unknown> = {
      connect: (to: unknown) => to,
      loop: false,
      start(this: { loop: boolean }, when: number, offset?: number, duration?: number): void {
        sources++;
        started.push({ when, offset, duration, loop: this.loop });
      },
      stop: () => {},
      frequency: param(),
      gain: param(),
      Q: param(),
      playbackRate: param(),
      pan: param(),
      ...extra,
    };
    return n;
  };
  const ctx = {
    currentTime: 0,
    sampleRate: 100,
    destination: node(),
    createGain: () => node(),
    createBiquadFilter: () => node(),
    createDynamicsCompressor: () => node(),
    createStereoPanner: () => node(),
    createBufferSource: () => node(),
    createOscillator: () => node(),
    createBuffer: (_c: number, length: number) => ({ duration: 2, getChannelData: () => new Float32Array(length) }),
    resume: () => Promise.resolve(),
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  };
  return { ctx: ctx as unknown as AudioContext, sources: () => sources, closed: () => closed, started, targets: () => targets };
}

const fire = (x: number, z: number): GameEvent => ({ type: 'fire', owner: 'player', x, y: 2, z });

describe('createAudio', () => {
  it('does nothing before resume() and without Web Audio', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.play([fire(10, 0)], ear);
    expect(f.sources()).toBe(0);

    const none = createAudio(() => null);
    expect(() => {
      none.resume();
      none.play([fire(10, 0)], ear);
      none.ambience(8, 5);
      none.dispose();
    }).not.toThrow();
  });

  it('starts the ambience on resume and plays audible events', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    const ambient = f.sources(); // sea, wind and hull-water loops
    expect(ambient).toBe(3);
    a.play([fire(50, 0)], ear);
    expect(f.sources()).toBeGreaterThan(ambient);
  });

  it('skips sounds that are too far away to hear', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    const before = f.sources();
    a.play([fire(50000, 0)], ear);
    expect(f.sources()).toBe(before);
  });

  it('caps the voices started in one frame', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    const before = f.sources();
    a.play(Array.from({ length: 60 }, () => fire(40, 0)), ear);
    // 10 cannons, each a noise burst plus a tone.
    expect(f.sources() - before).toBe(20);
  });

  it('mutes and unmutes', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    expect(a.muted).toBe(false);
    expect(a.toggleMute()).toBe(true);
    const before = f.sources();
    a.play([fire(40, 0)], ear);
    expect(f.sources()).toBe(before);
    expect(a.toggleMute()).toBe(false);
    a.play([fire(40, 0)], ear);
    expect(f.sources()).toBeGreaterThan(before);
  });

  it('closes the context on dispose and ignores later calls', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    a.dispose();
    expect(f.closed()).toBe(true);
    const n = f.sources();
    a.play([fire(40, 0)], ear);
    expect(f.sources()).toBe(n);
  });
});

describe('createAudio details', () => {
  it('slices every noise burst inside the 2 s buffer, and loops the longer ones', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    const ambient = f.started.length;
    const events: GameEvent[] = [
      { type: 'sunk', owner: 'enemy', x: 40, y: 0, z: 0 },
      { type: 'splash', owner: 'player', x: 40, y: 0, z: 0 },
      { type: 'hit', owner: 'player', x: 40, y: 0, z: 0 },
      fire(40, 0),
    ];
    for (let i = 0; i < 40; i++) a.play(events, ear); // random offsets: many draws
    for (const s of f.started.slice(ambient)) {
      if (s.offset === undefined || s.duration === undefined) continue; // oscillators have no slice
      if (!s.loop) expect(s.offset + s.duration).toBeLessThanOrEqual(2 + 1e-9);
      else expect(s.offset).toBeLessThan(2);
    }
    expect(f.started.slice(ambient).some((s) => s.loop)).toBe(true); // the 3.5 s sinking rumble loops
  });

  it('only retunes the ambience when wind or speed really change', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    a.ambience(8, 5);
    const n = f.targets();
    for (let i = 0; i < 100; i++) a.ambience(8.05, 5.02); // a frame loop with tiny jitter
    expect(f.targets()).toBe(n);
    a.ambience(11, 5);
    expect(f.targets()).toBeGreaterThan(n);
  });
});

describe('damage mappings', () => {
  it('are silent when pristine, monotonic and capped', () => {
    expect(creakGain(1, 0)).toBe(0);
    expect(sloshGain(0)).toBe(0);
    expect(crackleDensity(0)).toBe(0);
    expect(crackleGain(0)).toBe(0);
    for (let i = 0; i < 10; i++) {
      const a = i / 10;
      const b = (i + 1) / 10;
      expect(creakGain(1 - b, 0)).toBeGreaterThan(creakGain(1 - a, 0));
      expect(creakGain(1, b)).toBeGreaterThan(creakGain(1, a));
      expect(sloshGain(b)).toBeGreaterThan(sloshGain(a));
      expect(crackleDensity(b)).toBeGreaterThan(crackleDensity(a));
      expect(crackleGain(b)).toBeGreaterThan(crackleGain(a));
    }
    expect(creakGain(-5, 9)).toBeLessThanOrEqual(0.12 + 1e-9);
    expect(sloshGain(9)).toBeLessThanOrEqual(0.14 + 1e-9);
    expect(crackleGain(9)).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(crackleDensity(9)).toBeLessThanOrEqual(24);
  });
});

describe('zone hits', () => {
  const hitAt = (zone?: 'waterline' | 'hull' | 'rigging'): GameEvent => ({ type: 'hit', owner: 'player', x: 40, y: 0, z: 0, zone });
  const voices = (zone?: 'waterline' | 'hull' | 'rigging'): { n: number; slices: Started[] } => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    const before = f.started.length;
    expect(() => a.play([hitAt(zone)], ear)).not.toThrow();
    return { n: f.started.length - before, slices: f.started.slice(before) };
  };

  it('each zone makes sound, and the zones sound different', () => {
    const [rig, water, hull, none] = [voices('rigging'), voices('waterline'), voices('hull'), voices()];
    expect(hull.n).toBeGreaterThan(0);
    expect(none.n).toBe(hull.n);
    expect(rig.n).not.toBe(hull.n);
    expect(water.n).not.toBe(hull.n);
    expect(rig.n).not.toBe(water.n);
  });

  it('keeps every noise slice inside the buffer', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    const before = f.started.length;
    for (let i = 0; i < 40; i++) a.play([hitAt('rigging'), hitAt('waterline')], ear);
    for (const s of f.started.slice(before)) {
      if (s.offset === undefined || s.duration === undefined) continue;
      if (!s.loop) expect(s.offset + s.duration).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it('still respects the per-frame voice cap', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    const before = f.started.length;
    a.play(Array.from({ length: 30 }, () => hitAt('rigging')), ear);
    expect(f.started.length - before).toBeLessThanOrEqual(10 * 4);
  });
});

describe('condition ambience', () => {
  const pristineC = { rigging: 1, flooding: 0, fire: 0 };
  const wrecked = { rigging: 0.3, flooding: 0.6, fire: 0.5 };

  it('creates no layers for a pristine ship', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    const n = f.sources();
    const t = f.targets();
    a.condition(pristineC);
    expect(f.sources()).toBe(n);
    expect(f.targets()).toBe(t);
  });

  it('starts layers on damage, retunes only on real change, and applies a condition set before resume', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.condition(wrecked); // before the engine exists: a no-op that is remembered
    a.resume();
    const n = f.sources();
    expect(n).toBeGreaterThan(3);
    a.condition(wrecked);
    const t = f.targets();
    for (let i = 0; i < 100; i++) a.condition({ rigging: 0.3 + 0.001 * i % 0.01, flooding: 0.6, fire: 0.5 });
    expect(f.targets()).toBe(t);
    expect(f.sources()).toBe(n);
    a.condition({ ...wrecked, fire: 0.9 });
    expect(f.targets()).toBeGreaterThan(t);
  });

  it('stops the layers when repaired and on dispose, and can restart them', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    a.condition(wrecked);
    const n = f.sources();
    a.condition(pristineC);
    a.condition(wrecked);
    expect(f.sources()).toBeGreaterThan(n); // fresh layers
    a.dispose();
    expect(() => a.condition(wrecked)).not.toThrow();
  });

  it('stays silent when muted by routing through the master gain', () => {
    const f = fakeContext();
    const a = createAudio(() => f.ctx);
    a.resume();
    a.toggleMute();
    expect(() => a.condition(wrecked)).not.toThrow();
    expect(a.muted).toBe(true);
  });
});
