import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { clothClock } from '../src/ships/clothState';
import { createSailTrim } from '../src/ships/trim';

/** The scale fallback of `trim.ts`: sails of pivots the cloth shader does not move (a mesh that is not a grid). */
describe('createSailTrim without the shader', () => {
  const time = { t: 0 };
  beforeEach(() => {
    time.t = 0;
    clothClock.now = () => time.t;
  });
  const make = (): { sq: THREE.Object3D; aft: THREE.Object3D; trim: ReturnType<typeof createSailTrim> } => {
    const sq = new THREE.Group();
    const aft = new THREE.Group();
    return { sq, aft, trim: createSailTrim({ square: [sq], aft: [aft] }, { tiers: 3 }) };
  };
  const run = (t: ReturnType<typeof createSailTrim>, w: number, l: number, seconds: number, each?: () => void): void => {
    for (let i = 0; i < seconds * 30; i++) {
      time.t += 1 / 30;
      t.trim(w, l);
      each?.();
    }
  };

  it('shrinks smoothly when furled, hides only once almost gone, and sets again', () => {
    const { sq, trim } = make();
    run(trim, 1.5, 1, 2);
    expect(sq.visible && sq.scale.y > 0.99).toBe(true);
    let prev = 1;
    run(trim, 1.5, 0, 8, () => {
      expect(sq.scale.y).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - sq.scale.y).toBeLessThan(0.1);
      prev = sq.scale.y;
    });
    expect(sq.visible).toBe(false);
    run(trim, 1.5, 1, 8);
    expect(sq.visible && sq.scale.y > 0.99).toBe(true);
  });

  it('mirrors fore-and-aft sails with the belly, never collapsing or flipping in one step', () => {
    const { aft, trim } = make();
    run(trim, 1, 1, 8);
    expect(aft.scale.z).toBeGreaterThan(0.8);
    let prev = aft.scale.z;
    run(trim, -1, 1, 8, () => {
      expect(Math.abs(aft.scale.z)).toBeGreaterThanOrEqual(0.06 - 1e-9);
      expect(Math.abs(aft.scale.z - prev)).toBeLessThan(0.2);
      prev = aft.scale.z;
    });
    expect(aft.scale.z).toBeLessThan(-0.8);
  });

  it('ignores non-finite input instead of poisoning the springs', () => {
    const { sq, trim } = make();
    run(trim, 1, 1, 2);
    trim.trim(Number.NaN, 1);
    trim.trim(1, Number.NaN);
    trim.setWind({ angle: Number.NaN, speed: 8, gust: 1 });
    run(trim, 1, 1, 1);
    expect(Number.isFinite(sq.scale.y) && Number.isFinite(sq.rotation.y)).toBe(true);
  });
});
