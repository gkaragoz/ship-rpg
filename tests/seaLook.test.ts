import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { lookFor } from '../src/render/seaLook';
import { sunState } from '../src/world';
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

  it('is bright at noon, gold at dusk, dark and blue at night, and the storm is darker by night than by day', () => {
    const at = (h: number, sea = 0) => lookFor(sea, sunState(h));
    const noon = at(12);
    const dusk = at(18.4);
    const night = at(0);
    const lum = (c: THREE.Color): number => c.r * 0.3 + c.g * 0.6 + c.b * 0.1;
    expect(lum(noon.zenith)).toBeGreaterThan(lum(night.zenith) * 5);
    expect(dusk.horizon.r).toBeGreaterThan(dusk.horizon.b); // an orange horizon
    expect(night.sun).toBeLessThan(noon.sun * 0.5);
    expect(night.lamps).toBe(1);
    expect(noon.lamps).toBe(0);
    expect(night.stars).toBeGreaterThan(0.9);
    expect(noon.stars).toBe(0);
    expect(lum(at(12, 1).horizon)).toBeGreaterThan(lum(at(0, 1).horizon));
  });

  it('lights the day from the sun and the night from the moon, never from below the horizon, and fades through dusk', () => {
    const noon = lookFor(0, sunState(12));
    expect(noon.lightDir.y).toBeGreaterThan(0.7);
    expect(noon.lightColor.r).toBeGreaterThan(0.9);
    const night = lookFor(0, sunState(0));
    expect(night.lightDir.y).toBeGreaterThan(0.2); // the moon is up at midnight
    expect(night.lightColor.b).toBeGreaterThan(night.lightColor.r); // and its light is blue
    let previous = lookFor(0, sunState(12)).sun;
    for (let h = 12.5; h <= 20; h += 0.5) {
      const s = lookFor(0, sunState(h)).sun;
      expect(s).toBeLessThanOrEqual(previous + 0.4); // no jump up while the sun sets
      previous = s;
    }
  });

  it('clamps out-of-range states and reuses the output object', () => {
    const out = lookFor(0.3);
    expect(lookFor(2, undefined, out)).toBe(out);
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
