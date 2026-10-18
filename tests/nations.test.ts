import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createGame } from '../src/gameplay';
import { SHIP_SPECS, createShip, getShipSpec } from '../src/ships';
import { NATIONS, getNation } from '../src/world';

describe('nations', () => {
  it('has distinct ids, Turkish names and flag colours, including the player and pirates', () => {
    const ids = NATIONS.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['free', 'pirate', 'english', 'french', 'spanish', 'dutch']));
    expect(new Set(NATIONS.map((n) => n.flag)).size).toBe(NATIONS.length);
    for (const n of NATIONS) expect(n.name.length).toBeGreaterThan(2);
  });

  it('falls back to the free captain for an unknown id', () => {
    expect(getNation('atlantis').id).toBe('free');
    expect(getNation('french').flag).toBe(0x2e5fa8);
  });
});

describe('ship flags', () => {
  const flagged = (root: THREE.Object3D, color: number): THREE.Mesh[] => {
    const found: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshBasicMaterial && o.material.color.getHex() === color) found.push(o);
    });
    return found;
  };

  it.each(SHIP_SPECS.map((s) => [s.id, s] as const))('%s flies its flag on the mast and at the stern', (_id, s) => {
    const ship = createShip(s, { flag: 0x123456 });
    const cloths = flagged(ship.root, 0x123456);
    expect(cloths.length).toBeGreaterThanOrEqual(2); // masthead pennant + stern ensign
    const stern = ship.root.getObjectByName('stern-flag');
    expect(stern).toBeDefined();
    const box = new THREE.Box3().setFromObject(stern as THREE.Object3D);
    expect(box.max.y).toBeGreaterThan(s.freeboard); // standing above the deck
    expect(box.min.x).toBeLessThan(-s.length / 2 + 1); // streaming aft of the pole
    ship.dispose();
  });

  it('defaults to a red flag when none is given', () => {
    const ship = createShip(getShipSpec('brig')!);
    expect(flagged(ship.root, 0xc0392b).length).toBeGreaterThanOrEqual(2);
    ship.dispose();
  });
});

describe('enemy nation in the game view', () => {
  it('assigns a known nation to every enemy', () => {
    const v = createGame(getShipSpec('brig')!).view();
    expect(v.enemies).toHaveLength(1);
    expect(v.enemies[0]!.nation).toBe('pirate'); // the first enemy flies the black flag
    for (const e of v.enemies) expect(NATIONS.map((n) => n.id)).toContain(e.nation);
  });
});
