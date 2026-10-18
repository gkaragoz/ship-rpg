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

describe('hull transom', () => {
  it.each(SHIP_SPECS.map((s) => [s.id, s] as const))('%s has a closed stern cap (no missing wedge)', (_id, s) => {
    const ship = createShip(s);
    const hull = ship.root.getObjectByName('hull') as THREE.Mesh;
    const index = hull.geometry.getIndex();
    const pos = hull.geometry.getAttribute('position');
    // The fan centre is the last vertex; its triangles must cover the whole stern ring.
    const centre = pos.count - 1;
    const tris: number[][] = [];
    for (let i = 0; i < (index?.count ?? 0); i += 3) {
      const t = [index!.getX(i), index!.getX(i + 1), index!.getX(i + 2)];
      if (t.includes(centre)) tris.push(t);
    }
    expect(tris).toHaveLength(17); // 16 ring segments + the closing wedge
    ship.dispose();
  });
});

describe('Ship.setSailTrim', () => {
  const brig = SHIP_SPECS.find((s) => s.id === 'brig');
  if (!brig) throw new Error('brig spec missing');

  const trims = (root: THREE.Object3D, name: string): THREE.Object3D[] => {
    const out: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (o.name === name) out.push(o);
    });
    return out;
  };

  it('hides sails when furled and shows them when set', () => {
    const ship = createShip(brig);
    ship.setSailTrim(1.5, 0);
    expect(trims(ship.root, 'trim-square').every((o) => !o.visible)).toBe(true);
    ship.setSailTrim(1.5, 1);
    expect(trims(ship.root, 'trim-square').every((o) => o.visible)).toBe(true);
    ship.dispose();
  });

  it('mirrors fore-and-aft sails to the leeward side and braces yards harder when close-hauled', () => {
    const ship = createShip(brig);
    ship.setSailTrim(1.0, 1); // wind from port
    const aft = trims(ship.root, 'trim-aft')[0];
    const square = trims(ship.root, 'trim-square')[0];
    expect(aft?.scale.z).toBe(1);
    const closeBrace = square?.rotation.y ?? 0;

    ship.setSailTrim(-1.0, 1); // wind from starboard
    expect(aft?.scale.z).toBe(-1);
    expect(square?.rotation.y).toBeCloseTo(-closeBrace);

    ship.setSailTrim(1.0, 0.5); // half sail: reefed to 0.35 + 0.65 * level of full height
    expect(square?.scale.y).toBeCloseTo(0.675);
    expect(aft?.scale.y).toBeCloseTo(0.675);

    ship.setSailTrim(3.0, 1); // running
    expect(Math.abs(square?.rotation.y ?? 1)).toBeLessThan(Math.abs(closeBrace));
    ship.dispose();
  });
});
