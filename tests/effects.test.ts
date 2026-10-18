import { describe, expect, it } from 'vitest';
import { burnRate, emitAccumulator, MAX_BURN_EMIT, type EmitAccumulator } from '../src/render/effects';

const total = (rate: number, dt: number, seconds: number): number => {
  const acc: EmitAccumulator = { carry: 0 };
  let n = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) n += emitAccumulator(acc, rate, dt);
  return n;
};

describe('burnRate', () => {
  it('is 0 at intensity 0 and for bad input', () => {
    expect(burnRate(0)).toBe(0);
    expect(burnRate(-1)).toBe(0);
    expect(burnRate(NaN)).toBe(0);
  });
  it('increases monotonically and is capped above 1', () => {
    let prev = 0;
    for (let i = 0.05; i <= 1.0001; i += 0.05) {
      const r = burnRate(i);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
    expect(burnRate(5)).toBe(burnRate(1));
  });
});

describe('emitAccumulator', () => {
  it('carries fractions between frames', () => {
    const acc: EmitAccumulator = { carry: 0 };
    expect(emitAccumulator(acc, 10, 0.05)).toBe(0);
    expect(emitAccumulator(acc, 10, 0.05)).toBe(1);
    expect(acc.carry).toBeCloseTo(0, 6);
  });
  it('emits nothing for zero rate or dt', () => {
    const acc: EmitAccumulator = { carry: 0 };
    expect(emitAccumulator(acc, 0, 1)).toBe(0);
    expect(emitAccumulator(acc, 10, 0)).toBe(0);
    expect(acc.carry).toBe(0);
  });
  it('is frame-rate independent within tolerance', () => {
    const rate = burnRate(0.7);
    const expected = rate * 10;
    for (const dt of [1 / 144, 1 / 60, 1 / 30, 1 / 20]) {
      expect(Math.abs(total(rate, dt, 10) - expected)).toBeLessThanOrEqual(1.5);
    }
  });
  it('caps one call, dropping the excess', () => {
    const acc: EmitAccumulator = { carry: 0 };
    expect(emitAccumulator(acc, 1000, 1)).toBe(MAX_BURN_EMIT);
    expect(emitAccumulator(acc, 1000, 1, 2)).toBe(2);
  });
});
