import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { SHIP_SPECS, createShip } from '../src/ships';
import { clothClock } from '../src/ships/clothState';
import { gatheredXY } from './clothReference';
import { isCloth, shipClothUniforms } from './clothUtil';

/** The procedural ships use the same cloth shader modes as the GLB ones (docs/SHIPS.md). */
describe.each(SHIP_SPECS.map((s) => [s.id, s] as const))('procedural %s cloth', (_id, spec) => {
  beforeEach(() => {
    clothClock.now = () => 0;
  });

  it('gives every sail, jib and boom a cloth code and a patched material, and the booms follow their sail', () => {
    const ship = createShip(spec);
    const cloth: THREE.Mesh[] = [];
    ship.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry.getAttribute('clothA')) cloth.push(o);
    });
    expect(cloth.length).toBeGreaterThan(0);
    const jibCodes: number[] = [];
    let moved = 0;
    for (const m of cloth) {
      expect(isCloth(m.material as THREE.Material), m.name).toBe(true);
      expect(m.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
      const A = m.geometry.getAttribute('clothA');
      for (let v = 0; v < A.count; v++) expect(A.getX(v)).toBeGreaterThan(0);
      if (A.getX(0) >= 5 && A.getX(0) < 10) jibCodes.push(A.getX(0));
      if (A.getX(0) === 14) {
        // a boom or gaff: its transform is baked into the geometry, and it moves with the sail
        expect(m.position.length()).toBe(0);
        const pos = m.geometry.getAttribute('position');
        for (let v = 0; v < A.count; v++) {
          const [x, y] = gatheredXY(m.geometry, v, 0.8);
          if (Math.hypot(x - pos.getX(v), y - pos.getY(v)) > 1e-3) moved++;
        }
      }
    }
    if (spec.masts.some((m) => m.rig === 'gaff' || m.spanker)) expect(moved, 'some boom vertices follow the furled sail').toBeGreaterThan(0);
    expect(jibCodes.length).toBe(spec.jibs);
    expect(new Set(jibCodes).size).toBe(Math.min(spec.jibs, 3)); // each jib has its own slot
    ship.dispose();
  });

  it('furls the jibs through their own uniforms', () => {
    const ship = createShip(spec);
    const u = shipClothUniforms(ship.root);
    expect((u.uJibFurl?.value as THREE.Vector4).toArray()).toEqual([0, 0, 0, 0]);
    ship.setSailTrim(1.2, 0);
    if (spec.jibs > 0) expect((u.uJibFurl?.value as THREE.Vector4).x).toBeGreaterThan(0.99);
    ship.dispose();
  });
});
