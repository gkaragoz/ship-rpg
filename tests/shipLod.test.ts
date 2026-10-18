import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LOD_RANGES, createDeck, lodUpdateDue, selectLod, type ShipLod, type ShipModelMeta } from '../src/ships';
import { createGlbShip } from '../src/ships/glbShip';
import type { ShipAsset } from '../src/ships/assets';
import { getShipSpec } from '../src/ships';
import { clothClock } from '../src/ships/clothState';

const L = 12; // tartane length

describe('selectLod', () => {
  const [a, b] = LOD_RANGES;

  it('uses plain thresholds scaled by ship length on the first frame', () => {
    expect(selectLod(a * L - 1, L, null)).toBe(0);
    expect(selectLod(a * L + 1, L, null)).toBe(1);
    expect(selectLod(b * L - 1, L, null)).toBe(1);
    expect(selectLod(b * L + 1, L, null)).toBe(2);
    expect(selectLod(1e6, L, null)).toBe(2);
  });

  it('is scale invariant: a ship 5x longer switches 5x farther away', () => {
    expect(selectLod(a * L * 5 - 1, L * 5, null)).toBe(0);
    expect(selectLod(a * L * 5 + 1, L * 5, null)).toBe(1);
  });

  it('applies hysteresis: no flicker around a threshold', () => {
    const edge = a * L;
    let lod: ShipLod = selectLod(edge - 1, L, null);
    expect(lod).toBe(0);
    // Jitter ±5% around the edge: must not switch to LOD1 until 12% past it.
    for (const f of [1.01, 0.97, 1.05, 0.99, 1.08]) lod = selectLod(edge * f, L, lod);
    expect(lod).toBe(0);
    lod = selectLod(edge * 1.2, L, lod);
    expect(lod).toBe(1);
    // ...and does not come back until 12% inside it.
    for (const f of [0.99, 1.03, 0.95, 0.9]) lod = selectLod(edge * f, L, lod);
    expect(lod).toBe(1);
    lod = selectLod(edge * 0.8, L, lod);
    expect(lod).toBe(0);
  });

  it('can skip a level when a ship moves fast', () => {
    expect(selectLod(b * L * 2, L, 0)).toBe(2);
    expect(selectLod(1, L, 2)).toBe(0);
  });

  it('staggers refreshes so a fleet does not update on one frame', () => {
    const due = (frame: number): number => [0, 1, 2, 3, 4, 5].filter((i) => lodUpdateDue(frame, i)).length;
    for (let f = 0; f < 12; f++) expect(due(f)).toBe(1);
  });
});

describe('createGlbShip', () => {
  const lod = (n: number, withPivot: boolean): THREE.Group => {
    const g = new THREE.Group();
    g.name = `LOD${n}`;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    if (withPivot) {
      const p = new THREE.Group();
      p.name = `LOD${n}_trim-aft`;
      g.add(p);
    }
    return g;
  };
  const scene = new THREE.Group();
  scene.add(lod(0, true), lod(1, true), lod(2, true));
  const spec = getShipSpec('tartane');
  if (!spec) throw new Error('no tartane');
  const asset = { id: 'tartane', scene } as unknown as ShipAsset;

  it('shows exactly one LOD and starts at full quality', () => {
    const ship = createGlbShip(spec, asset);
    const visible = (): boolean[] => [0, 1, 2].map((i) => ship.root.getObjectByName(`LOD${i}`)?.visible ?? false);
    expect(visible()).toEqual([true, false, false]);
    ship.setLod?.(2);
    expect(visible()).toEqual([false, false, true]);
    ship.setLod?.(1);
    expect(visible()).toEqual([false, true, false]);
  });

  it('clones the asset instead of reusing it, and dispose keeps shared geometry alive', () => {
    const ship = createGlbShip(spec, asset);
    expect(ship.root).not.toBe(scene);
    let disposed = false;
    const mesh = ship.root.getObjectByName('LOD0')?.children[0] as THREE.Mesh;
    mesh.geometry.addEventListener('dispose', () => (disposed = true));
    ship.dispose();
    expect(disposed).toBe(false);
  });

  it('trims the sail pivot of every LOD and mirrors it with the wind side', () => {
    let t = 0;
    clothClock.now = () => t;
    const ship = createGlbShip(spec, asset);
    const settle = (windRel: number, level: number): void => {
      for (let i = 0; i < 10; i++) {
        t += 2; // the sails ease over a few seconds; a call never counts more than 2 s
        ship.setSailTrim(windRel, level);
      }
    };
    ship.setSailTrim(1.2, 1); // wind from port
    settle(1.2, 1);
    const pivots = [0, 1, 2].map((i) => ship.root.getObjectByName(`LOD${i}_trim-aft`) as THREE.Object3D);
    for (const p of pivots) {
      expect(p.rotation.y).toBeGreaterThan(0);
      expect(p.scale.z).toBeGreaterThan(0.8);
    }
    settle(-1.2, 1); // wind from starboard
    for (const p of pivots) {
      expect(p.rotation.y).toBeLessThan(0);
      expect(p.scale.z).toBeLessThan(-0.8);
    }
    settle(0, 0); // furled
    for (const p of pivots) expect(p.visible).toBe(false);
  });
});

describe('createDeck', () => {
  const meta: ShipModelMeta = {
    id: 't', length: 10, beam: 4, lods: {}, trimPivot: [0, 1, 0], lantern: [0, 1, 0],
    deck: { columns: ['x', 'y', 'halfWidth'], stations: [[-5, 2, 0.5], [0, 1.5, 1.5], [5, 2.5, 0]] },
    obstacles: [{ type: 'circle', x: 1, z: 0, r: 0.3 }, { type: 'rect', x0: -3, x1: -2, z0: -0.5, z1: 0.5 }],
  };
  const deck = createDeck(meta);

  it('interpolates height and half width and clamps outside the ends', () => {
    expect(deck.heightAt(-2.5)).toBeCloseTo(1.75);
    expect(deck.halfWidthAt(2.5)).toBeCloseTo(0.75);
    expect(deck.heightAt(-99)).toBe(2);
    expect(deck.halfWidthAt(99)).toBe(0);
  });

  it('is walkable only inside the deck and clear of obstacles (with body radius)', () => {
    expect(deck.walkable(0, 0, 0.2)).toBe(true);
    expect(deck.walkable(0, 1.45, 0.2)).toBe(false); // too close to the rail
    expect(deck.walkable(1.4, 0, 0.2)).toBe(false); // against the circle
    expect(deck.walkable(1.6, 0, 0.2)).toBe(true);
    expect(deck.walkable(-2.5, 0, 0.2)).toBe(false); // inside the rect
    expect(deck.walkable(4.9, 0, 0.2)).toBe(false); // past the end
  });
});
