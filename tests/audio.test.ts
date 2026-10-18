import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core';
import { REFERENCE_DISTANCE, SPEED_OF_SOUND, createAudio, spatialMix } from '../src/audio';

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
function fakeContext(): { ctx: AudioContext; sources: () => number; closed: () => boolean } {
  let sources = 0;
  let closed = false;
  const param = (): object => ({
    value: 0,
    setValueAtTime(): void {},
    exponentialRampToValueAtTime(): void {},
    setTargetAtTime(): void {},
  });
  const node = (extra: object = {}): object => {
    const n: Record<string, unknown> = {
      connect: (to: unknown) => to,
      start: () => {
        sources++;
      },
      stop: () => {},
      frequency: param(),
      gain: param(),
      Q: param(),
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
    createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    resume: () => Promise.resolve(),
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  };
  return { ctx: ctx as unknown as AudioContext, sources: () => sources, closed: () => closed };
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
