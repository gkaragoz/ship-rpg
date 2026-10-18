import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SHIP_SPECS, createShip } from '../src/ships';

const EXPECTED_IDS = [
  'tartane', 'barque', 'yacht', 'lugger', 'sloop', 'galeoth', 'xebec', 'schooner',
  'caravel', 'fleut', 'brig', 'pinnace', 'galleon', 'corvette', 'frigate', 'battleship',
];

describe('ship specs', () => {
  it('contain exactly the 16 required ship types, once each', () => {
    expect(SHIP_SPECS.map((s) => s.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it.each(SHIP_SPECS.map((s) => [s.id, s] as const))('%s has sane geometry and stats', (_id, s) => {
    expect(s.length).toBeGreaterThan(s.beam);
    expect(s.draft).toBeGreaterThan(0);
    expect(s.masts.length).toBeGreaterThan(0);
    for (const m of s.masts) {
      expect(m.at).toBeGreaterThan(0);
      expect(m.at).toBeLessThan(1);
      expect(m.height).toBeGreaterThan(0);
    }
    expect(s.stats.rank).toBeGreaterThanOrEqual(1);
    expect(s.stats.rank).toBeLessThanOrEqual(7);
    expect(s.stats.hp).toBeGreaterThan(0);
    expect(s.stats.cannons).toBeGreaterThanOrEqual(0);
  });

  it('keep larger original classes at least as tough as smaller ones', () => {
    const maxHp = new Map<number, number>();
    for (const s of SHIP_SPECS) maxHp.set(s.stats.rank, Math.max(maxHp.get(s.stats.rank) ?? 0, s.stats.hp));
    for (let rank = 1; rank < 7; rank++) {
      expect(maxHp.get(rank)).toBeGreaterThan(maxHp.get(rank + 1) ?? 0);
    }
  });
});

describe('createShip', () => {
  it.each(SHIP_SPECS.map((s) => [s.id, s] as const))('%s builds finite geometry matching its length', (_id, s) => {
    const ship = createShip(s);
    const hull = ship.root.getObjectByName('hull');
    expect(hull).toBeDefined();
    const box = new THREE.Box3().setFromObject(hull as THREE.Object3D);
    const length = box.max.x - box.min.x;
    expect(length).toBeGreaterThan(s.length * 0.99);
    expect(length).toBeLessThan(s.length * 1.1);

    ship.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const pos = o.geometry.getAttribute('position');
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
    });
    ship.dispose();
  });
});
