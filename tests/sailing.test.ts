import { describe, expect, it } from 'vitest';
import type { Controls, WindView } from '../src/core';
import { createGame } from '../src/gameplay';
import { SAILING, createPlayerShip, maxSpeed, stepPlayerShip, type PlayerShip } from '../src/gameplay/sailing';
import { getShipSpec } from '../src/ships';

const brig = getShipSpec('brig');
if (!brig) throw new Error('brig spec missing');

const NONE: Controls = { rudder: 0, sailStep: 0 };
const DT = 1 / 60;

/** Wind from the north (north is -z): a beam wind for a ship heading east. */
const north: WindView = { from: Math.PI / 2, speed: 8 };

function run(ship: PlayerShip, wind: WindView, seconds: number, controls: Controls = NONE): void {
  for (let i = 0; i < seconds / DT; i++) {
    stepPlayerShip(ship, brig!, wind, i === 0 ? controls : { ...controls, sailStep: 0 }, DT);
  }
}

describe('stepPlayerShip', () => {
  it('accelerates toward a high speed on a beam reach with full sails', () => {
    const ship = createPlayerShip(0, 0, 0);
    run(ship, north, 90, { rudder: 0, sailStep: 1 });
    expect(ship.sailTarget).toBe(1);
    expect(ship.speed).toBeGreaterThan(0.7 * maxSpeed(brig));
    expect(ship.speed).toBeLessThanOrEqual(maxSpeed(brig) * SAILING.overspeed + 1e-6);
  });

  it('cannot make way straight into the wind', () => {
    const ship = createPlayerShip(0, 0, north.from);
    run(ship, north, 60, { rudder: 0, sailStep: 1 });
    expect(ship.efficiency).toBe(0);
    expect(ship.speed).toBeLessThan(0.05 * maxSpeed(brig));
  });

  it('slows to a stop with sails furled', () => {
    const ship = createPlayerShip(0, 0, 0);
    ship.speed = maxSpeed(brig);
    ship.sailTarget = 0;
    ship.sailLevel = 0;
    run(ship, north, 60);
    expect(ship.speed).toBeLessThan(0.05 * maxSpeed(brig));
  });

  it('steps sail target in halves and clamps it to 0…1', () => {
    const ship = createPlayerShip();
    stepPlayerShip(ship, brig, north, { rudder: 0, sailStep: 1 }, DT);
    expect(ship.sailTarget).toBe(1);
    stepPlayerShip(ship, brig, north, { rudder: 0, sailStep: 1 }, DT);
    expect(ship.sailTarget).toBe(1);
    stepPlayerShip(ship, brig, north, { rudder: 0, sailStep: -1 }, DT);
    stepPlayerShip(ship, brig, north, { rudder: 0, sailStep: -1 }, DT);
    stepPlayerShip(ship, brig, north, { rudder: 0, sailStep: -1 }, DT);
    expect(ship.sailTarget).toBe(0);
  });

  it('cannot turn while dead in the water', () => {
    const ship = createPlayerShip(0, 0, 0);
    ship.sailTarget = 0;
    ship.sailLevel = 0;
    run(ship, north, 5, { rudder: 1, sailStep: 0 });
    expect(ship.heading).toBeCloseTo(0);
  });

  it('turns to starboard (heading decreases) and to port (increases) when moving', () => {
    const starboard = createPlayerShip(0, 0, 0);
    starboard.speed = maxSpeed(brig);
    run(starboard, north, 3, { rudder: 1, sailStep: 0 });
    expect(starboard.heading).toBeLessThan(-0.05);

    const port = createPlayerShip(0, 0, 0);
    port.speed = maxSpeed(brig);
    run(port, north, 3, { rudder: -1, sailStep: 0 });
    expect(port.heading).toBeGreaterThan(0.05);
  });

  it('keeps the heading wrapped to [-π, π]', () => {
    const ship = createPlayerShip(0, 0, Math.PI - 0.01);
    ship.speed = maxSpeed(brig);
    run(ship, north, 10, { rudder: -1, sailStep: 0 });
    expect(Math.abs(ship.heading)).toBeLessThanOrEqual(Math.PI);
  });

  it('moves along its heading: east at ψ = 0, north (−z) at ψ = π/2', () => {
    const east = createPlayerShip(0, 0, 0);
    east.speed = 5;
    stepPlayerShip(east, brig, north, NONE, 1);
    expect(east.x).toBeGreaterThan(1);
    expect(Math.abs(east.z)).toBeLessThan(1e-9);

    const up = createPlayerShip(0, 0, Math.PI / 2);
    up.speed = 5;
    stepPlayerShip(up, brig, north, NONE, 1);
    expect(up.z).toBeLessThan(-1);
  });

  it('heels away from the wind: wind from port heels to starboard (+)', () => {
    const ship = createPlayerShip(0, 0, 0); // wind from the north = port side
    ship.sailTarget = 1;
    ship.sailLevel = 1;
    run(ship, north, 5);
    expect(ship.roll).toBeGreaterThan(0.02);

    const mirror = createPlayerShip(0, 0, Math.PI); // facing west: wind from starboard
    mirror.sailTarget = 1;
    mirror.sailLevel = 1;
    run(mirror, north, 5);
    expect(mirror.roll).toBeLessThan(-0.02);
  });
});

describe('createGame', () => {
  it('advances time and exposes a consistent view', () => {
    const game = createGame(brig);
    for (let i = 0; i < 60; i++) game.update(DT, { rudder: 0, sailStep: i === 0 ? 1 : 0 });
    const v = game.view();
    expect(v.time).toBeCloseTo(1);
    expect(v.ship.sailTarget).toBe(1);
    expect(v.ship.x).toBeGreaterThan(0);
    expect(v.ship.maxKnots).toBeCloseTo(brig.stats.speed);
    expect(v.ship.knots).toBeLessThanOrEqual(v.ship.maxKnots * SAILING.overspeed);
    expect(v.wind.speed).toBeGreaterThan(0);
  });
});
