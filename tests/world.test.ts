import { describe, expect, it } from 'vitest';
import { NOMINAL_WIND, sailEfficiency, windAt } from '../src/world';

describe('windAt', () => {
  it('is deterministic for a given time', () => {
    expect(windAt(123.4)).toEqual(windAt(123.4));
  });

  it('stays in a sailable range and shifts slowly over time', () => {
    for (let t = 0; t < 3600; t += 7) {
      const w = windAt(t);
      expect(w.speed).toBeGreaterThan(3);
      expect(w.speed).toBeLessThan(13);
      expect(Math.abs(w.from - Math.PI / 2)).toBeLessThan(0.7);
    }
    expect(Math.abs(windAt(1).from - windAt(0).from)).toBeLessThan(0.05);
    expect(NOMINAL_WIND).toBe(8);
  });
});

describe('sailEfficiency', () => {
  const deg = (d: number): number => (d * Math.PI) / 180;

  it('is zero in irons (sailing into the wind)', () => {
    expect(sailEfficiency(0)).toBe(0);
    expect(sailEfficiency(deg(25))).toBe(0);
  });

  it('is symmetric for port and starboard', () => {
    expect(sailEfficiency(-deg(80))).toBe(sailEfficiency(deg(80)));
  });

  it('peaks on a broad reach and beats close-hauled and dead downwind', () => {
    const closeHauled = sailEfficiency(deg(45));
    const beam = sailEfficiency(deg(90));
    const broad = sailEfficiency(deg(120));
    const running = sailEfficiency(Math.PI);
    expect(beam).toBeGreaterThan(closeHauled);
    expect(broad).toBeGreaterThanOrEqual(beam);
    expect(broad).toBeGreaterThan(running);
    expect(broad).toBeCloseTo(1);
  });

  it('stays within 0…1 for any angle', () => {
    for (let a = -7; a <= 7; a += 0.1) {
      const e = sailEfficiency(a);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });
});
