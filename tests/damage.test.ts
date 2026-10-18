import { describe, expect, it } from 'vitest';
import type { Controls, WindView } from '../src/core';
import { createGame } from '../src/gameplay';
import { ballHitZone, type Ball } from '../src/gameplay/combat';
import { DAMAGE, WATERLINE_BAND, hitEffect, repairRigging, riggingSpeedFactor, riggingTurnFactor } from '../src/gameplay/damage';
import { createPlayerShip, maxSpeed, stepPlayerShip } from '../src/gameplay/sailing';
import { SHIP_SPECS, getShipSpec } from '../src/ships';

const brig = getShipSpec('brig')!;
const DT = 1 / 60;
const NONE: Controls = { rudder: 0, sailStep: 0 };
/** Beam wind (from the north, north is -z) for a ship heading east, over open sea. */
const north: WindView = { from: Math.PI / 2, speed: 8 };
const OPEN = { x: 40000, z: 40000 };

const ballAt = (y: number, x = 0, z = 0): Ball => ({ id: 1, owner: 'player', x, y, z, vx: 0, vy: 0, vz: 0, damage: 40, age: 0 });
const target = { x: 0, z: 0, heading: 0 };

describe('hit zones', () => {
  it('splits a ball by its height: waterline, hull, rigging, and misses above the rigging line or below the keel', () => {
    expect(ballHitZone(ballAt(0.3), target, brig)).toBe('waterline');
    expect(ballHitZone(ballAt(WATERLINE_BAND - 0.01), target, brig)).toBe('waterline');
    expect(ballHitZone(ballAt(WATERLINE_BAND + 0.01), target, brig)).toBe('hull');
    expect(ballHitZone(ballAt(brig.freeboard - 0.01), target, brig)).toBe('hull');
    expect(ballHitZone(ballAt(brig.freeboard + 0.01), target, brig)).toBe('rigging');
    expect(ballHitZone(ballAt(brig.freeboard + 1.49), target, brig)).toBe('rigging');
    expect(ballHitZone(ballAt(brig.freeboard + 1.6), target, brig)).toBeNull();
    expect(ballHitZone(ballAt(-brig.draft - 1), target, brig)).toBeNull();
  });

  it('misses outside the footprint whatever the height, and follows the ship heading', () => {
    expect(ballHitZone(ballAt(1.5, brig.length), target, brig)).toBeNull();
    expect(ballHitZone(ballAt(1.5, 0, brig.beam), target, brig)).toBeNull();
    expect(ballHitZone(ballAt(1.5, brig.length * 0.4, 0), { x: 0, z: 0, heading: Math.PI / 2 }, brig)).toBeNull();
    expect(ballHitZone(ballAt(1.5, 0, -brig.length * 0.4), { x: 0, z: 0, heading: Math.PI / 2 }, brig)).toBe('hull');
  });

  it('puts the same ball in the same zone for every ship: zones depend on its height and the ship deck line', () => {
    for (const s of SHIP_SPECS) {
      expect(ballHitZone(ballAt(0.2), target, s), s.id).toBe('waterline');
      expect(ballHitZone(ballAt(s.freeboard + 0.5), target, s), s.id).toBe('rigging');
    }
  });
});

describe('hit effect', () => {
  it('a hull or waterline hit takes the full damage and leaves the rigging alone', () => {
    for (const zone of ['hull', 'waterline'] as const) expect(hitEffect(zone, 40, 2500)).toEqual({ hull: 40, rigging: 0 });
  });

  it('a rigging hit costs part of the hull damage and wrecks some sail, in proportion to the ship strength', () => {
    const fx = hitEffect('rigging', 40, 2500);
    expect(fx.hull).toBeCloseTo(40 * DAMAGE.riggingHullShare, 5);
    expect(fx.rigging).toBeCloseTo((40 / 2500) * DAMAGE.riggingPerHull, 5);
    // The same ball is a bigger blow to a small ship's sails than to a great ship's.
    expect(hitEffect('rigging', 40, 500).rigging).toBeGreaterThan(fx.rigging * 4);
  });

  it('about twenty well-placed rigging hits take a Brig down to the floor', () => {
    let r = 1;
    let hits = 0;
    while (r > 0.05 && hits < 100) {
      r -= hitEffect('rigging', 40, 2500).rigging;
      hits++;
    }
    expect(hits).toBeGreaterThan(10);
    expect(hits).toBeLessThan(30);
  });
});

describe('what wrecked rigging does', () => {
  it('scales speed and turning between the floor and 1, monotonically', () => {
    expect(riggingSpeedFactor(1)).toBe(1);
    expect(riggingSpeedFactor(0)).toBe(DAMAGE.speedFloor);
    expect(riggingTurnFactor(1)).toBe(1);
    expect(riggingTurnFactor(0)).toBe(DAMAGE.turnFloor);
    let last = 0;
    for (let r = 0; r <= 1.0001; r += 0.1) {
      expect(riggingSpeedFactor(r)).toBeGreaterThanOrEqual(last);
      last = riggingSpeedFactor(r);
    }
    expect(riggingSpeedFactor(-3)).toBe(DAMAGE.speedFloor); // clamped
    expect(riggingSpeedFactor(7)).toBe(1);
  });

  const sail = (rigging: number, seconds: number): ReturnType<typeof createPlayerShip> => {
    const s = createPlayerShip(OPEN.x, OPEN.z, 0);
    s.sailTarget = 1;
    s.sailLevel = 1;
    s.rigging = rigging;
    for (let i = 0; i < seconds / DT; i++) {
      s.rigging = rigging; // hold it fixed: this is about the effect, not the repair
      stepPlayerShip(s, brig, north, NONE, DT);
    }
    return s;
  };

  it('a ship with wrecked sails tops out at a fraction of its speed on a beam reach', () => {
    const whole = sail(1, 90);
    const wrecked = sail(0, 90);
    expect(whole.speed).toBeGreaterThan(0.7 * maxSpeed(brig));
    expect(wrecked.speed).toBeLessThan(0.45 * maxSpeed(brig));
    expect(wrecked.speed).toBeGreaterThan(0.2 * maxSpeed(brig)); // jury rig: it still moves
    expect(sail(0.5, 90).speed).toBeGreaterThan(wrecked.speed);
    expect(sail(0.5, 90).speed).toBeLessThan(whole.speed);
  });

  it('and turns more slowly with the same rudder', () => {
    const turned = (rigging: number): number => {
      const s = createPlayerShip(OPEN.x, OPEN.z, 0);
      s.speed = maxSpeed(brig);
      s.sailTarget = 1;
      s.sailLevel = 1;
      for (let i = 0; i < 5 / DT; i++) {
        s.rigging = rigging;
        s.speed = maxSpeed(brig); // same way on, so only the rigging differs
        stepPlayerShip(s, brig, north, { rudder: 1, sailStep: 0 }, DT);
      }
      return Math.abs(s.heading);
    };
    const whole = turned(1);
    const wrecked = turned(0);
    expect(wrecked).toBeLessThan(whole * 0.7);
    expect(wrecked).toBeGreaterThan(whole * 0.4);
  });
});

describe('mending', () => {
  it('is slow at sea and stops part-way, fast in harbour and complete', () => {
    expect(repairRigging(0.2, false, 60)).toBeCloseTo(0.2 + DAMAGE.seaRepair * 60, 5);
    expect(repairRigging(0.69, false, 600)).toBe(DAMAGE.seaRepairCap);
    expect(repairRigging(0.8, false, 600)).toBe(0.8); // above the cap: nothing at sea
    expect(repairRigging(0.2, true, 10)).toBeCloseTo(0.2 + DAMAGE.dockRepair * 10, 5);
    expect(repairRigging(0.99, true, 100)).toBe(1);
  });

  it('a moored ship in the game gets its sails back', () => {
    const game = createGame(brig);
    game.dev.setRigging(0.1);
    game.update(DT, { rudder: 0, sailStep: 0, interact: true });
    expect(game.view().docked).toBe('douwesen');
    for (let i = 0; i < 60 * 10; i++) game.update(DT, NONE);
    expect(game.view().ship.rigging).toBeGreaterThan(0.1 + DAMAGE.dockRepair * 9);
    for (let i = 0; i < 60 * 40; i++) game.update(DT, NONE);
    expect(game.view().ship.rigging).toBe(1);
  });
});

describe('in the game', () => {
  it('reports the rigging of the player and of each enemy, full at the start', () => {
    const v = createGame(brig).view();
    expect(v.ship.rigging).toBe(1);
    expect(v.ship.flooding).toBe(0);
    expect(v.ship.fire).toBe(0);
    expect(v.enemies[0]!.rigging).toBe(1);
  });

  it('a dev-set rigging value shows in the view and is clamped', () => {
    const game = createGame(brig);
    game.dev.setRigging(0.4);
    expect(game.view().ship.rigging).toBeCloseTo(0.4, 5);
    game.dev.setRigging(9);
    expect(game.view().ship.rigging).toBe(1);
    game.dev.setRigging(-1);
    expect(game.view().ship.rigging).toBe(0);
  });

  it('enemy fire wrecks the player sails over a fight, and every hit event carries its zone', () => {
    const game = createGame(getShipSpec('tartane')!); // unarmed: the enemy hunts it down
    const zones: Record<string, number> = {};
    let minRigging = 1;
    for (let i = 0; i < 60 * 900 && !game.view().sunk; i++) {
      game.update(DT, NONE);
      const v = game.view();
      minRigging = Math.min(minRigging, v.ship.rigging);
      for (const e of v.events) if (e.type === 'hit' && e.owner === 'enemy') zones[e.zone ?? 'none'] = (zones[e.zone ?? 'none'] ?? 0) + 1;
    }
    expect(zones.none).toBeUndefined();
    expect(Object.values(zones).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(minRigging).toBeLessThan(1);
  });
});
