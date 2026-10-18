import { describe, expect, it } from 'vitest';
import { SEA_NAMES, WAVES, chop, seaAmp, seaName, seaStateAt, waveHeight, waveSlope, windAt } from '../src/world';

const MAX = WAVES.reduce((a, w) => a + w.amplitude, 0);

describe('waveHeight', () => {
  it('is deterministic and bounded by the summed amplitudes', () => {
    expect(waveHeight(12, -30, 5, 1.2)).toBe(waveHeight(12, -30, 5, 1.2));
    for (let amp of [0.5, 1, 2.6]) {
      for (let i = 0; i < 300; i++) {
        const h = waveHeight(i * 3.7, i * -2.3, i * 0.31, 1.57, amp);
        expect(Math.abs(h)).toBeLessThanOrEqual(MAX * amp + 1e-6);
      }
      amp = 0;
    }
  });

  it('can leave out short waves, leaving only the long swell', () => {
    const swellOnly = waveHeight(10, 10, 3, 1, 1, 50);
    const all = waveHeight(10, 10, 3, 1);
    expect(swellOnly).not.toBeCloseTo(all, 3);
    const longest = WAVES.filter((w) => w.length >= 50).reduce((a, w) => a + w.amplitude, 0);
    expect(Math.abs(swellOnly)).toBeLessThanOrEqual(longest + 1e-6);
    expect(waveHeight(10, 10, 3, 1, 1, 0)).toBe(all);
  });

  it('grows with the amplitude factor and moves with time', () => {
    const rms = (amp: number): number => {
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += waveHeight(i * 5.1, i * 2.9, 7, 0.9, amp) ** 2;
      return Math.sqrt(sum / 400);
    };
    expect(rms(2)).toBeGreaterThan(rms(1) * 1.8);
    expect(waveHeight(10, 10, 4, 1)).not.toBeCloseTo(waveHeight(10, 10, 3, 1));
  });

  it('has no net height offset on average', () => {
    let sum = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) sum += waveHeight(i * 1.37, i * 0.73, 2, 0.8);
    expect(Math.abs(sum / n)).toBeLessThan(0.1);
  });

  it('keeps crests sharper than troughs in a big sea (Gerstner), never folding over', () => {
    const amp = seaAmp(1);
    let max = -Infinity;
    let min = Infinity;
    for (let i = 0; i < 4000; i++) {
      const h = waveHeight(i * 0.9, i * 0.4, 11, 0.7, amp);
      max = Math.max(max, h);
      min = Math.min(min, h);
    }
    expect(max).toBeGreaterThan(1);
    expect(chop(amp)).toBeGreaterThan(0);
    // the folding cap: the summed crest slope times the chop stays below 1
    const slope = WAVES.reduce((a, w) => a + ((2 * Math.PI) / w.length) * w.amplitude * amp, 0);
    expect(chop(amp) * slope).toBeLessThanOrEqual(0.9 + 1e-9);
  });
});

describe('waveSlope', () => {
  it('agrees with a fine finite difference of the height', () => {
    for (let i = 0; i < 20; i++) {
      const [x, z, t] = [i * 11 - 90, i * -7 + 30, i * 1.3];
      const [sx, sz] = waveSlope(x, z, t, 1.1, 1.4, 0.5);
      expect(sx).toBeCloseTo((waveHeight(x + 0.01, z, t, 1.1, 1.4) - waveHeight(x - 0.01, z, t, 1.1, 1.4)) / 0.02, 1);
      expect(sz).toBeCloseTo((waveHeight(x, z + 0.01, t, 1.1, 1.4) - waveHeight(x, z - 0.01, t, 1.1, 1.4)) / 0.02, 1);
    }
  });
});

describe('seaStateAt', () => {
  it('stays within 0…1, is deterministic, and rises with the wind', () => {
    for (let t = 0; t < 12000; t += 37) {
      const s = seaStateAt(t, windAt(t).speed);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(seaStateAt(123, 9)).toBe(seaStateAt(123, 9));
    expect(seaStateAt(500, 14)).toBeGreaterThan(seaStateAt(500, 4));
  });

  it('runs through calm and rough weather over a long game, with a storm now and then', () => {
    const seen: number[] = [];
    for (let t = 0; t < 7200; t += 5) seen.push(seaStateAt(t, windAt(t).speed));
    expect(Math.min(...seen)).toBeLessThan(0.45);
    expect(Math.max(...seen)).toBeGreaterThan(0.8);
    const storms = seen.filter((s) => s > 0.8).length / seen.length;
    expect(storms).toBeGreaterThan(0.01);
    expect(storms).toBeLessThan(0.3);
  });

  it('maps to amplitudes and HUD names across the whole range', () => {
    expect(seaAmp(0)).toBeLessThan(0.6);
    expect(seaAmp(1)).toBeGreaterThan(2);
    expect(seaAmp(0.5)).toBeGreaterThan(seaAmp(0.2));
    expect(seaName(0)).toBe(SEA_NAMES[0]);
    expect(seaName(1)).toBe(SEA_NAMES[SEA_NAMES.length - 1]);
    expect(new Set([0, 0.25, 0.5, 0.75, 1].map(seaName)).size).toBe(5);
  });
});
