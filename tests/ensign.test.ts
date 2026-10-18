import { describe, expect, it } from 'vitest';
import { ENSIGNS, FLAG_V0, PENNANT_V, isEnsign } from '../src/ships/flagArt';
import { flagStrip, prepareFlag } from '../src/ships/flagCloth';
import { NATIONS } from '../src/world';

describe('ensigns', () => {
  it('have art for every nation of the world, and nothing else', () => {
    expect([...ENSIGNS].sort()).toEqual(NATIONS.map((n) => n.id).sort());
    for (const n of NATIONS) expect(isEnsign(n.id)).toBe(true);
    expect(isEnsign('martian')).toBe(false);
    expect(isEnsign(undefined)).toBe(false);
  });

  it('map the flag cloth onto the art: hoist on the left, top at the pole, pennants on the plain strip', () => {
    const flag = flagStrip(3, 1.9, 0);
    prepareFlag(flag);
    const uv = flag.getAttribute('uv');
    const pos = flag.getAttribute('position');
    expect(uv.count).toBe(pos.count);
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(FLAG_V0 - 1e-6);
      expect(v).toBeLessThanOrEqual(1);
      expect(u).toBeCloseTo(-pos.getX(i) / 3, 5); // pole at x = 0, cloth streams towards -x
      expect(v).toBeCloseTo(FLAG_V0 + (1 - FLAG_V0) * (1 + pos.getY(i) / 1.9), 5);
    }
    const pennant = flagStrip(3, 0.3, 0);
    prepareFlag(pennant);
    const puv = pennant.getAttribute('uv');
    for (let i = 0; i < puv.count; i++) {
      expect(puv.getX(i)).toBeCloseTo(0.5, 6);
      expect(puv.getY(i)).toBeCloseTo(PENNANT_V, 6);
    }
  });
});
