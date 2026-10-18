import { describe, expect, it } from 'vitest';
import type { Controls, WindView } from '../src/core';
import { createGame } from '../src/gameplay';
import { SAILING, createPlayerShip, isBlocked, maxSpeed, stepPlayerShip, type PlayerShip } from '../src/gameplay/sailing';
import { getShipSpec } from '../src/ships';
import { PORTS, getPort, terrainHeight } from '../src/world';

const brig = getShipSpec('brig');
if (!brig) throw new Error('brig spec missing');

/** Deep open water, hundreds of kilometres from any island. */
const OPEN = { x: 40000, z: 40000 };
const afloat = (heading = 0): PlayerShip => createPlayerShip(OPEN.x, OPEN.z, heading);

const angleDiffTo = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

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
    const ship = afloat(0);
    run(ship, north, 90, { rudder: 0, sailStep: 1 });
    expect(ship.sailTarget).toBe(1);
    expect(ship.speed).toBeGreaterThan(0.7 * maxSpeed(brig));
    expect(ship.speed).toBeLessThanOrEqual(maxSpeed(brig) * SAILING.overspeed + 1e-6);
  });

  it('cannot make way straight into the wind', () => {
    const ship = afloat(north.from);
    run(ship, north, 60, { rudder: 0, sailStep: 1 });
    expect(ship.efficiency).toBe(0);
    expect(ship.speed).toBeLessThan(0.05 * maxSpeed(brig));
  });

  it('can always bear off the wind with sails set, so a ship in irons is never stuck', () => {
    const ship = afloat(north.from);
    ship.sailTarget = 1;
    ship.sailLevel = 1;
    run(ship, north, 25, { rudder: 1, sailStep: 0 });
    expect(Math.abs(angleDiffTo(ship.heading, north.from))).toBeGreaterThan(0.6);
    expect(ship.efficiency).toBeGreaterThan(0);
    // ... and once off the wind it sails away again.
    run(ship, north, 40);
    expect(ship.speed).toBeGreaterThan(0.2 * maxSpeed(brig!));
  });

  it('drifts slowly astern in irons rather than standing dead', () => {
    const ship = afloat(north.from);
    ship.sailTarget = 1;
    ship.sailLevel = 1;
    run(ship, north, 20);
    expect(ship.speed).toBeLessThan(0);
    expect(ship.speed).toBeGreaterThan(-0.1 * maxSpeed(brig!));
  });

  it('slows to a stop with sails furled', () => {
    const ship = afloat(0);
    ship.speed = maxSpeed(brig);
    ship.sailTarget = 0;
    ship.sailLevel = 0;
    run(ship, north, 60);
    expect(ship.speed).toBeLessThan(0.05 * maxSpeed(brig));
  });

  it('steps sail target in halves and clamps it to 0…1', () => {
    const ship = afloat();
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
    const ship = afloat(0);
    ship.sailTarget = 0;
    ship.sailLevel = 0;
    run(ship, north, 5, { rudder: 1, sailStep: 0 });
    expect(ship.heading).toBeCloseTo(0);
  });

  it('turns to starboard (heading decreases) and to port (increases) when moving', () => {
    const starboard = afloat(0);
    starboard.speed = maxSpeed(brig);
    run(starboard, north, 3, { rudder: 1, sailStep: 0 });
    expect(starboard.heading).toBeLessThan(-0.05);

    const port = afloat(0);
    port.speed = maxSpeed(brig);
    run(port, north, 3, { rudder: -1, sailStep: 0 });
    expect(port.heading).toBeGreaterThan(0.05);
  });

  it('keeps the heading wrapped to [-π, π]', () => {
    const ship = afloat(Math.PI - 0.01);
    ship.speed = maxSpeed(brig);
    run(ship, north, 10, { rudder: -1, sailStep: 0 });
    expect(Math.abs(ship.heading)).toBeLessThanOrEqual(Math.PI);
  });

  it('moves along its heading: east at ψ = 0, north (−z) at ψ = π/2', () => {
    const east = afloat(0);
    east.speed = 5;
    east.sailLevel = 0; // no sails, no leeway: the ship goes exactly where it points
    east.sailTarget = 0;
    stepPlayerShip(east, brig, north, NONE, 1);
    expect(east.x - OPEN.x).toBeGreaterThan(1);
    expect(Math.abs(east.z - OPEN.z)).toBeLessThan(1e-9);

    const up = afloat(Math.PI / 2);
    up.speed = 5;
    stepPlayerShip(up, brig, north, NONE, 1);
    expect(up.z - OPEN.z).toBeLessThan(-1);
  });

  it('heels away from the wind: wind from port heels to starboard (+)', () => {
    const ship = afloat(0); // wind from the north = port side
    ship.sailTarget = 1;
    ship.sailLevel = 1;
    run(ship, north, 5);
    expect(ship.roll).toBeGreaterThan(0.02);

    const mirror = afloat(Math.PI); // facing west: wind from starboard
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
    expect(v.ship.maxKnots).toBeCloseTo(brig.stats.speed);
    expect(v.ship.knots).toBeLessThanOrEqual(v.ship.maxKnots * SAILING.overspeed);
    expect(v.wind.speed).toBeGreaterThan(0);
  });
});

const douwesen = getPort('douwesen');
if (!douwesen) throw new Error('douwesen missing');

describe('terrain', () => {
  it('runs a ship aground instead of letting it sail onto an island', () => {
    // Start at the anchorage and steer straight at the island with full sail.
    const toward = Math.atan2(-(douwesen.town.z - douwesen.anchor.z), douwesen.town.x - douwesen.anchor.x);
    const ship = createPlayerShip(douwesen.anchor.x, douwesen.anchor.z, toward);
    ship.sailTarget = 1;
    ship.sailLevel = 1;
    ship.speed = maxSpeed(brig!);
    const wind: WindView = { from: toward + 2.0, speed: 10 };
    let grounded = false;
    for (let i = 0; i < 60 * 120; i++) {
      stepPlayerShip(ship, brig!, wind, NONE, DT);
      if (ship.grounded > 0) grounded = true;
      expect(isBlocked(ship, brig!)).toBe(false);
    }
    expect(grounded).toBe(true);
    expect(terrainHeight(ship.x, ship.z)).toBeLessThan(0);
  });

  it('lets the rudder work while aground so the ship can turn away', () => {
    const toward = Math.atan2(-(douwesen.town.z - douwesen.anchor.z), douwesen.town.x - douwesen.anchor.x);
    const ship = createPlayerShip(douwesen.anchor.x, douwesen.anchor.z, toward);
    ship.grounded = 1;
    const before = ship.heading;
    for (let i = 0; i < 60; i++) stepPlayerShip(ship, brig!, north, { rudder: 1, sailStep: 0 }, DT);
    expect(ship.heading).not.toBeCloseTo(before, 2);
  });
});

describe('grounding recovery and docking edge cases', () => {
  const toward = Math.atan2(-(douwesen.town.z - douwesen.anchor.z), douwesen.town.x - douwesen.anchor.x);

  it('never lets the rudder swing the hull onto the bottom, and frees a grounded ship', () => {
    const ship = createPlayerShip(douwesen.anchor.x, douwesen.anchor.z, toward);
    ship.sailTarget = 1;
    ship.sailLevel = 1;
    ship.speed = maxSpeed(brig!);
    const wind: WindView = { from: toward + 2.0, speed: 10 };
    // Drive at the shore, then keep the rudder hard over while aground.
    for (let i = 0; i < 60 * 90; i++) {
      stepPlayerShip(ship, brig!, wind, { rudder: i % 240 < 120 ? 1 : -1, sailStep: 0 }, DT);
      expect(isBlocked(ship, brig!)).toBe(false);
    }
    // Afterwards, with the rudder centred and sails furled, the ship settles afloat and is free to move.
    ship.sailTarget = 0;
    for (let i = 0; i < 60 * 10; i++) stepPlayerShip(ship, brig!, wind, NONE, DT);
    expect(isBlocked(ship, brig!)).toBe(false);
    expect(ship.grounded).toBe(0);
    expect(ship.speed).toBeGreaterThan(-0.05); // drifting astern has stopped
  });

  it('clears the grounded state when docking', () => {
    const ship = createPlayerShip(douwesen.anchor.x, douwesen.anchor.z, toward);
    ship.grounded = 1.2;
    ship.docked = true;
    stepPlayerShip(ship, brig!, north, NONE, DT);
    expect(ship.grounded).toBe(0);
    expect(ship.speed).toBe(0);
  });

  it('starts facing out to sea and reports the port direction consistently', () => {
    const v = createGame(brig!).view();
    const port = getPort('douwesen')!;
    // Facing out to sea: forward (cos ψ, -sin ψ) matches the port's outward direction (cos a, sin a).
    const fx = Math.cos(v.ship.heading);
    const fz = -Math.sin(v.ship.heading);
    expect(fx * Math.cos(port.outward) + fz * Math.sin(port.outward)).toBeCloseTo(1, 5);
    // The anchorage is behind us, so its direction is opposite the heading.
    expect(Math.cos(v.nearestPort!.direction - v.ship.heading)).toBeCloseTo(-1, 1);
  });

  it('discovers a port when its town comes within sight', () => {
    const game = createGame(brig!);
    expect(game.view().discoveredPorts).toContain('douwesen');
    expect(game.view().discoveredPorts).not.toContain('khoal-roa');
  });
});

describe('docking and discovery', () => {
  it('starts afloat near the start port, ready to dock, with that island discovered', () => {
    const v = createGame(brig!).view();
    expect(v.docked).toBeNull();
    expect(v.grounded).toBe(false);
    expect(v.nearestPort?.id).toBe('douwesen');
    expect(v.nearestPort?.dockable).toBe(true);
    expect(v.discoveredIslands).toContain('douwesen');
  });

  it('docks, stays moored whatever the controls say, and casts off again', () => {
    const game = createGame(brig!);
    game.update(DT, { rudder: 0, sailStep: 0, interact: true });
    const moored = game.view();
    expect(moored.docked).toBe('douwesen');
    expect(moored.nearestPort?.dockable).toBe(false); // already docked

    for (let i = 0; i < 180; i++) game.update(DT, { rudder: 1, sailStep: 1 });
    const later = game.view();
    expect(later.ship.x).toBe(moored.ship.x);
    expect(later.ship.z).toBe(moored.ship.z);
    expect(later.ship.speed).toBe(0);

    game.update(DT, { rudder: 0, sailStep: 0, interact: true });
    expect(game.view().docked).toBeNull();
  });

  it('cannot dock once sailed out of range, and discovers neighbouring islands on the way', () => {
    const game = createGame(brig!);
    game.update(DT, { rudder: 0, sailStep: 1 });
    for (let i = 0; i < 60 * 40; i++) game.update(DT, NONE);
    const v = game.view();
    expect(v.nearestPort?.dockable).toBe(false);
    game.update(DT, { rudder: 0, sailStep: 0, interact: true });
    expect(game.view().docked).toBeNull();
    expect(game.view().grounded).toBe(false);
    expect(PORTS.length).toBeGreaterThan(v.discoveredPorts.length);
  });
});
