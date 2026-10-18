import { describe, expect, it } from 'vitest';
import { NEUTRAL_TUNING, WAVES, WAVE_TERMS, chop, waveHeight, type SeaTuning } from '../src/world';

const rms = (tuning: SeaTuning, amp = 1): number => {
  let sum = 0;
  for (let i = 0; i < 400; i++) sum += waveHeight(i * 5.1, i * 2.9, 7, 0.9, amp, 0, tuning) ** 2;
  return Math.sqrt(sum / 400);
};

describe('sea tuning', () => {
  it('is the sea as designed by default', () => {
    expect(waveHeight(10, 20, 3, 1, 1.4)).toBe(waveHeight(10, 20, 3, 1, 1.4, 0, NEUTRAL_TUNING));
  });

  it('makes the waves taller, and flat at zero', () => {
    expect(rms({ ...NEUTRAL_TUNING, amp: 2 })).toBeGreaterThan(rms(NEUTRAL_TUNING) * 1.7);
    expect(rms({ ...NEUTRAL_TUNING, amp: 0 })).toBe(0);
  });

  it('stretches wavelengths, and speed 0 freezes the waves', () => {
    const diff = (len: number): number => {
      const tuning = { ...NEUTRAL_TUNING, length: len };
      return Math.abs(waveHeight(0, 0, 5, 1, 1, 0, tuning) - waveHeight(8, 0, 5, 1, 1, 0, tuning));
    };
    expect(diff(2.5)).toBeLessThan(diff(1));
    const still = { ...NEUTRAL_TUNING, speed: 0 };
    expect(waveHeight(3, 4, 1, 1, 1, 0, still)).toBeCloseTo(waveHeight(3, 4, 99, 1, 1, 0, still), 9);
  });

  it('keeps the surface from folding at any setting (the crest pull is capped)', () => {
    for (const tuning of [
      { amp: 3, length: 0.5, chop: 2, speed: 1 },
      { amp: 3, length: 1, chop: 2, speed: 1 },
    ]) {
      const g = chop(2.6, tuning);
      let slope = 0;
      WAVES.forEach((w, i) => (slope += ((WAVE_TERMS[i]?.k ?? 0) / tuning.length) * w.amplitude * 2.6 * tuning.amp));
      expect(g * slope).toBeLessThanOrEqual(0.9 + 1e-9);
    }
    expect(chop(1, { ...NEUTRAL_TUNING, chop: 0 })).toBe(0);
  });
});
