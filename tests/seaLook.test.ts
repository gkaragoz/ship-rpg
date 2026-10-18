import { describe, expect, it } from 'vitest';
import { lookFor } from '../src/render/seaLook';
import { noiseField } from '../src/render/seaNoise';

describe('lookFor', () => {
  it('turns grey, dark and close-in as the sea builds, smoothly', () => {
    const calm = lookFor(0);
    const mid = lookFor(0.5);
    const storm = lookFor(1);
    expect(storm.fogFar).toBeLessThan(mid.fogFar);
    expect(mid.fogFar).toBeLessThan(calm.fogFar);
    expect(storm.sun).toBeLessThan(calm.sun);
    expect(storm.cover).toBeGreaterThan(calm.cover);
    expect(storm.horizon.getHex()).not.toBe(calm.horizon.getHex());
    expect(storm.storm).toBe(1);
    expect(calm.storm).toBe(0);
    let prev = lookFor(0).fogFar;
    for (let s = 0.05; s <= 1.0001; s += 0.05) {
      const f = lookFor(s).fogFar;
      expect(f).toBeLessThanOrEqual(prev + 1e-9);
      prev = f;
    }
  });

  it('clamps out-of-range states and reuses the output object', () => {
    const out = lookFor(0.3);
    expect(lookFor(2, out)).toBe(out);
    expect(out.storm).toBe(1);
    expect(lookFor(-1).storm).toBe(0);
  });
});

describe('sea noise', () => {
  it('is deterministic, in range and tiles seamlessly', () => {
    const a = noiseField(64);
    const b = noiseField(64);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
    // neighbouring texels across the wrap are as close as neighbours inside
    let wrap = 0;
    let inner = 0;
    for (let j = 0; j < 64; j++) {
      wrap += Math.abs((a[j * 64] ?? 0) - (a[j * 64 + 63] ?? 0));
      inner += Math.abs((a[j * 64 + 31] ?? 0) - (a[j * 64 + 32] ?? 0));
    }
    expect(wrap).toBeLessThan(inner * 2 + 0.5);
  });
});
