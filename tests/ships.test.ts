import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { SHIP_SPECS, createShip } from '../src/ships';
import { clothClock } from '../src/ships/clothState';
import { shipClothUniforms } from './clothUtil';

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

  // The sails ease towards the trim on the clock; tests drive it by hand.
  const time = { t: 0 };
  beforeEach(() => {
    time.t = 0;
    clothClock.now = () => time.t;
  });
  const trim = (ship: ReturnType<typeof createShip>, windRel: number, level: number, seconds = 8): void => {
    for (let i = 0; i < seconds * 30; i++) {
      time.t += 1 / 30;
      ship.setSailTrim(windRel, level);
    }
  };

  const trims = (root: THREE.Object3D, name: string): THREE.Object3D[] => {
    const out: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (o.name === name) out.push(o);
    });
    return out;
  };

  it('furls tier by tier through the cloth uniforms, smoothly, and never hides the sails', () => {
    const ship = createShip(brig);
    const u = shipClothUniforms(ship.root);
    const furl = u.uFurl?.value as THREE.Vector4;
    const sq = trims(ship.root, 'trim-square');
    trim(ship, 1.5, 1);
    expect([furl.x, furl.y, furl.z]).toEqual([0, 0, 0]);
    let prev = [0, 0, 0];
    const first = [Infinity, Infinity, Infinity];
    for (let i = 0; i < 8 * 30; i++) {
      time.t += 1 / 30;
      ship.setSailTrim(1.5, 0);
      [furl.x, furl.y, furl.z].forEach((f, k) => {
        expect(f).toBeGreaterThanOrEqual((prev[k] as number) - 1e-9);
        expect(f - (prev[k] as number)).toBeLessThan(0.1); // never a pop
        if (f > 0.02 && first[k] === Infinity) first[k] = time.t;
      });
      prev = [furl.x, furl.y, furl.z];
      expect(sq.every((o) => o.visible && o.scale.y === 1)).toBe(true); // gathered by the shader, never scaled or hidden
    }
    expect(first[0]).toBeLessThan(first[1] as number); // the lowest tier first
    expect(first[1]).toBeLessThan(first[2] as number);
    expect(prev.every((f) => f > 0.99)).toBe(true);
    trim(ship, 1.5, 1);
    expect([furl.x, furl.y, furl.z].every((f) => f < 0.01)).toBe(true);
    ship.dispose();
  });

  it('swings the yards and sheets through the bow smoothly and belies fore-and-aft sails to leeward', () => {
    const ship = createShip(brig);
    const u = shipClothUniforms(ship.root);
    const belly = u.uBelly?.value as THREE.Vector2;
    const furl = u.uFurl?.value as THREE.Vector4;
    trim(ship, 1.0, 1); // wind from port
    const square = trims(ship.root, 'trim-square')[0];
    expect(belly.y).toBeGreaterThan(0.8);
    const closeBrace = square?.rotation.y ?? 0;
    expect(closeBrace).toBeGreaterThan(0.4);

    let prevB = belly.y;
    let prevBrace = closeBrace;
    let minAbs = Infinity;
    for (let i = 0; i < 8 * 30; i++) {
      time.t += 1 / 30;
      ship.setSailTrim(-1.0, 1); // tack: wind from starboard now
      const brace = square?.rotation.y ?? 0;
      expect(Math.abs(belly.y - prevB)).toBeLessThan(0.06); // the belly passes through zero, never flips
      expect(Math.abs(brace - prevBrace)).toBeLessThan(0.1);
      expect(belly.x).toBeGreaterThanOrEqual(0); // and a square sail is never backed through the mast
      minAbs = Math.min(minAbs, Math.abs(belly.y));
      prevB = belly.y;
      prevBrace = brace;
    }
    expect(minAbs).toBeLessThan(0.1);
    expect(belly.y).toBeLessThan(-0.8);
    expect(square?.rotation.y).toBeCloseTo(-closeBrace, 1);

    trim(ship, 3.0, 1); // running
    expect(Math.abs(square?.rotation.y ?? 1)).toBeLessThan(Math.abs(closeBrace));
    trim(ship, 1.0, 0.5); // half sail: the lowest tier is gathered, the next half way, the top one open
    expect(furl.x).toBeGreaterThan(0.95);
    expect(furl.y).toBeGreaterThan(0.3);
    expect(furl.y).toBeLessThan(0.7);
    expect(furl.z).toBeLessThan(0.05);
    ship.dispose();
  });

  it('takes an apparent wind and keeps working without one', () => {
    const ship = createShip(brig);
    ship.setWind?.({ angle: 0.5, speed: 14, gust: 1.2 });
    trim(ship, 1.0, 1);
    ship.setWind?.({ angle: -2, speed: 3, gust: 0.8 });
    trim(ship, 1.0, 1);
    ship.dispose();
  });
});
