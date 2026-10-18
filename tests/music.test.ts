import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRng } from '../src/core';
import { startMusic } from '../src/audio/music';
import { MODES, ROOT_MIDI, densityFor, midiToHz, modeFor, planBar, tempoFor, type MusicMood } from '../src/audio/musicPlan';

const day: MusicMood = { sea: 0.2, day: 1, docked: false };
const night: MusicMood = { sea: 0.2, day: 0, docked: false };
const storm: MusicMood = { sea: 0.95, day: 0.8, docked: false };
const harbour: MusicMood = { sea: 0.1, day: 1, docked: true };

describe('the score', () => {
  it('chooses a mode for each mood', () => {
    expect(modeFor(day)).toBe('lydian');
    expect(modeFor(night)).toBe('aeolian');
    expect(modeFor(storm)).toBe('phrygian');
    expect(modeFor(harbour)).toBe('ionian');
    expect(modeFor({ sea: 0.2, day: 0.5, docked: false })).toBe('dorian');
  });

  it('plays slow at night and in harbour, faster by day, fastest in a storm', () => {
    expect(tempoFor(night)).toBeLessThan(tempoFor(day));
    expect(tempoFor(harbour)).toBeLessThan(tempoFor(day));
    expect(tempoFor(storm)).toBeGreaterThan(tempoFor(day));
    for (const m of [day, night, storm, harbour]) {
      expect(tempoFor(m)).toBeGreaterThan(40);
      expect(tempoFor(m)).toBeLessThan(130);
    }
  });

  it('is sparse at night and denser on a lively sea', () => {
    expect(densityFor(night)).toBeLessThan(densityFor(day));
    expect(densityFor(day)).toBeLessThan(densityFor(storm));
    expect(densityFor({ sea: 0, day: 0, docked: true })).toBeGreaterThanOrEqual(0.15);
  });

  it('is the same piece for the same seed and a different one for another', () => {
    const play = (seed: number): string => {
      const rng = createRng(seed);
      return JSON.stringify(Array.from({ length: 8 }, (_, i) => planBar(day, i, rng)));
    };
    expect(play(1)).toBe(play(1));
    expect(play(1)).not.toBe(play(2));
  });

  it('keeps every note in the key of its mode', () => {
    for (const mood of [day, night, storm, harbour]) {
      const rng = createRng(7);
      for (let i = 0; i < 16; i++) {
        const bar = planBar(mood, i, rng);
        const scale = new Set(MODES[bar.mode]);
        for (const midi of [...bar.chord, bar.bass, ...bar.notes.map((n) => n.midi)]) {
          expect(scale.has((((midi - ROOT_MIDI) % 12) + 12) % 12), `${bar.mode} bar ${i} note ${midi}`).toBe(true);
        }
        for (const n of bar.notes) {
          expect(n.beat).toBeGreaterThanOrEqual(0);
          expect(n.beat).toBeLessThan(4);
          expect(n.length).toBeGreaterThan(0);
        }
        expect(bar.chord).toHaveLength(3);
        expect(bar.bass).toBeLessThan(bar.chord[0]!);
      }
    }
  });

  it('beats the drum only when the sea is rough', () => {
    expect(planBar(day, 0, createRng(1)).drums).toEqual([]);
    expect(planBar(storm, 0, createRng(1)).drums.length).toBeGreaterThan(0);
  });

  it('turns MIDI numbers into frequencies', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(57)).toBeCloseTo(220);
  });
});

/** A Web Audio stand-in that accepts everything and counts the oscillators started. */
function fakeContext(): { ctx: AudioContext; started: () => number; setTime: (t: number) => void } {
  let started = 0;
  let now = 0;
  const param = (): object => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = (): object => {
    const n: Record<string, unknown> = {
      connect: (to: unknown) => to,
      start: () => (started += 1),
      stop() {},
      frequency: param(),
      detune: param(),
      gain: param(),
      type: 'sine',
    };
    return n;
  };
  const ctx = {
    get currentTime() {
      return now;
    },
    createOscillator: node,
    createGain: node,
    createBiquadFilter: node,
  } as unknown as AudioContext;
  return { ctx, started: () => started, setTime: (t) => (now = t) };
}

describe('the music engine', () => {
  afterEach(() => vi.useRealTimers());

  it('writes the first bars at once and more as the clock moves, and stops when asked', () => {
    vi.useFakeTimers();
    const f = fakeContext();
    const out = f.ctx.createGain();
    const music = startMusic(f.ctx, out, 3);
    const first = f.started();
    expect(first).toBeGreaterThan(4); // a pad, a bass and some notes
    f.setTime(30);
    vi.advanceTimersByTime(1000);
    expect(f.started()).toBeGreaterThan(first);
    music.stop();
    const after = f.started();
    f.setTime(90);
    vi.advanceTimersByTime(5000);
    expect(f.started()).toBe(after);
  });

  it('follows the mood: a storm adds drums', () => {
    vi.useFakeTimers();
    const calm = fakeContext();
    startMusic(calm.ctx, calm.ctx.createGain(), 5).stop();
    const rough = fakeContext();
    const music = startMusic(rough.ctx, rough.ctx.createGain(), 5);
    music.setMood(storm);
    music.stop();
    // the stormy engine was started with the default mood (first bar), then switched: advance and compare later bars
    const a = fakeContext();
    const calmMusic = startMusic(a.ctx, a.ctx.createGain(), 5);
    const b = fakeContext();
    const stormMusic = startMusic(b.ctx, b.ctx.createGain(), 5);
    stormMusic.setMood(storm);
    a.setTime(40);
    b.setTime(40);
    vi.advanceTimersByTime(1000);
    expect(b.started()).toBeGreaterThan(a.started());
    calmMusic.stop();
    stormMusic.stop();
  });
});
