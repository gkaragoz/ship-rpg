import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GameView, OtherShipView } from '../src/core';
import { createGame } from '../src/gameplay';
import { createFleet } from '../src/render/fleet';
import { getShipSpec, type Ship, type ShipLod, type ShipSpec } from '../src/ships';

const found = getShipSpec('tartane');
if (!found) throw new Error('no tartane');
const spec: ShipSpec = found;

/** A ship stand-in that records the LOD it was asked to show. */
function fakeShip(): Ship & { lod: ShipLod | null } {
  const ship = {
    spec,
    root: new THREE.Group(),
    lod: null as ShipLod | null,
    setSailTrim: (): void => undefined,
    setCondition: (): void => undefined,
    setLod(l: ShipLod): void {
      ship.lod = l;
    },
    dispose: (): void => undefined,
  };
  return ship;
}

const other = (id: number, x: number): OtherShipView => ({ id, specId: 'tartane', x, z: 0, heading: 0, sailLevel: 1, roll: 0, apparent: { angle: 0, speed: 0 } });
const base = createGame(spec).view();
const viewOf = (others: OtherShipView[]): GameView => ({ ...base, others });
const camera = new THREE.PerspectiveCamera();

describe('fleet LOD by distance', () => {
  it('gives near, mid and far ships LOD0, LOD1 and LOD2 and counts them', () => {
    const scene = new THREE.Scene();
    const fleet = createFleet(scene);
    const ships = [fakeShip(), fakeShip(), fakeShip()];
    fleet.setShips(ships);
    fleet.update(viewOf([other(0, 20), other(1, 120), other(2, 600)]), camera, 1);
    expect(ships.map((s) => s.lod)).toEqual([0, 1, 2]);
    expect(fleet.lodCounts()).toEqual([1, 1, 1]);
    expect(ships.every((s) => s.root.parent === scene)).toBe(true);
  });

  it('hides ships beyond the cull distance and honours the debug override', () => {
    const fleet = createFleet(new THREE.Scene());
    const ships = [fakeShip(), fakeShip()];
    fleet.setShips(ships);
    fleet.update(viewOf([other(0, 5000), other(1, 600)]), camera, 1);
    expect(ships[0]?.root.visible).toBe(false);
    expect(fleet.lodCounts()).toEqual([0, 0, 1]);
    fleet.setOverride(0);
    fleet.update(viewOf([other(0, 5000), other(1, 600)]), camera, 1);
    expect(ships[1]?.lod).toBe(0);
  });

  it('never touches ships it was not given (the player ship is not in the fleet)', () => {
    const fleet = createFleet(new THREE.Scene());
    const player = fakeShip();
    fleet.setShips([fakeShip()]);
    fleet.update(viewOf([other(0, 900)]), camera, 1);
    expect(player.lod).toBeNull();
  });
});
