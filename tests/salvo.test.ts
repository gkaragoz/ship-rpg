import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core';
import { getShipSpec } from '../src/ships';
import { COMBAT, ELEVATION, aimZone, cannonsPerSide, stepBall } from '../src/gameplay/combat';
import { arcFor, fireGun, planBroadside } from '../src/gameplay/gunnery';
import { createGame } from '../src/gameplay';
import { createSalvo } from '../src/gameplay/salvo';
import { createPlayerShip } from '../src/gameplay/sailing';

const spec = (id: string) => {
  const s = getShipSpec(id);
  if (!s) throw new Error(`no ${id}`);
  return s;
};
const brig = spec('brig');
const DT = 1 / 60;

describe('a rippling broadside', () => {
  it('gives every gun its own delay, within about three quarters of a second, the same for the same seed', () => {
    const plan = (seed: number) => planBroadside(brig, createRng(seed), 1, undefined, true);
    const a = plan(5);
    expect(a).toHaveLength(cannonsPerSide(brig));
    const delays = a.map((s) => s.delay);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...delays)).toBeLessThan(0.95);
    expect(new Set(delays.map((d) => d.toFixed(3))).size).toBeGreaterThan(a.length * 0.8);
    expect(plan(5)).toEqual(a);
    expect(plan(6)).not.toEqual(a);
  });

  it('goes off fore to aft or aft to fore: one end of the ship fires clearly before the other', () => {
    const delays = planBroadside(brig, createRng(9), 1, undefined, true).map((s) => s.delay);
    const half = delays.length / 2;
    const early = delays.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const late = delays.slice(half).reduce((a, b) => a + b, 0) / half;
    expect(Math.abs(early - late)).toBeGreaterThan(0.1);
  });

  it('is not rippled for the duel: no delay, and the same random sequence as before', () => {
    const plain = planBroadside(brig, createRng(3), 1);
    expect(plain.every((s) => s.delay === 0)).toBe(true);
    const rng = createRng(3);
    plain.forEach((s) => {
      expect(s.yaw).toBeCloseTo((rng() * 2 - 1) * COMBAT.yawJitter, 12);
      expect(s.elev).toBeCloseTo(COMBAT.elevationMin + (COMBAT.elevationMax - COMBAT.elevationMin) * rng(), 12);
    });
  });
});

describe('the salvo queue', () => {
  it('releases the guns over time from the ship as it is then, and kicks the hull away from the guns', () => {
    const ship = createPlayerShip(0, 0, 0);
    ship.speed = 5;
    const salvo = createSalvo();
    salvo.queue('player', ship, brig, 'starboard', planBroadside(brig, createRng(1), 1, undefined, true), () => true);
    let id = 0;
    let fired = 0;
    let firedFirst = -1;
    for (let i = 0; i < 90; i++) {
      ship.x += ship.speed * DT; // the ship keeps moving
      fired += salvo.step(DT, () => ++id).balls.length;
      if (i === 0) firedFirst = fired;
    }
    expect(fired).toBe(cannonsPerSide(brig));
    expect(firedFirst).toBeLessThan(cannonsPerSide(brig));
    expect(salvo.waiting).toBe(0);
    expect(ship.body.rollV).toBeGreaterThan(0); // starboard guns: the starboard side comes up
  });

  it('drops the guns of a ship that is lost before their turn', () => {
    const ship = createPlayerShip(0, 0, 0);
    const salvo = createSalvo();
    let alive = true;
    salvo.queue('enemy', ship, brig, 'port', planBroadside(brig, createRng(2), 1, undefined, true), () => alive);
    alive = false;
    let id = 0;
    let fired = 0;
    for (let i = 0; i < 90; i++) fired += salvo.step(DT, () => ++id).balls.length;
    expect(fired).toBe(0);
    expect(ship.body.rollV).toBe(0);
  });

  it('gives one muzzle blast per gun, pointing along the barrel', () => {
    const ship = createPlayerShip(0, 0, 0);
    const salvo = createSalvo();
    salvo.queue('player', ship, brig, 'port', planBroadside(brig, createRng(4), 1, undefined, true), () => true);
    let id = 0;
    const events = [];
    for (let i = 0; i < 90; i++) events.push(...salvo.step(DT, () => ++id).events);
    expect(events).toHaveLength(cannonsPerSide(brig));
    for (const e of events) expect(e.nz).toBeCloseTo(-1); // port of a ship facing +x is -z
  });
});

describe('laying the guns', () => {
  it('reaches further the higher they are laid, and the aim zone follows', () => {
    const far = (elev: number): number => aimZone(brig, 0, elev).far;
    expect(far(0.04)).toBeLessThan(far(0.08));
    expect(far(0.08)).toBeLessThan(far(0.14));
    expect(far(0.14)).toBeLessThan(far(0.21));
    expect(Math.abs(far(ELEVATION.rest) - aimZone(brig, 0).far)).toBeLessThan(15); // the rest elevation is the old band's middle
  });

  it('draws the arc a ball really flies: its last point is where a fired ball lands', () => {
    const ship = createPlayerShip(100, 50, 0.4);
    ship.speed = 4;
    const air = { x: -3, z: 2 };
    for (const elev of [0.05, 0.1, 0.18]) {
      const arc = arcFor(brig, ship, 'starboard', elev, air);
      const n = cannonsPerSide(brig);
      const { ball } = fireGun('player', ship, brig, 'starboard', Math.floor((n - 1) / 2), n, { yaw: 0, elev, delay: 0 }, () => 0);
      for (let i = 0; i < 60 * 10 && ball.y > 0; i++) stepBall(ball, DT, air);
      const last = arc[arc.length - 1]!;
      expect(Math.hypot(last.x - ball.x, last.z - ball.z)).toBeLessThan(2);
      expect(arc[0]!.y).toBeGreaterThan(1); // starts at the muzzle
      expect(Math.max(...arc.map((p) => p.y))).toBeGreaterThan(arc[0]!.y); // and rises
    }
  });

  it('is laid up and down by the controls, within its limits, and shown in the view', () => {
    const game = createGame(brig);
    const start = game.view().ship.elevation;
    expect(start).toBeCloseTo(ELEVATION.rest);
    for (let i = 0; i < 60; i++) game.update(DT, { rudder: 0, sailStep: 0, elevate: 1 });
    expect(game.view().ship.elevation).toBeGreaterThan(start);
    for (let i = 0; i < 60 * 3; i++) game.update(DT, { rudder: 0, sailStep: 0, elevate: 1 });
    expect(game.view().ship.elevation).toBeCloseTo(ELEVATION.max);
    for (let i = 0; i < 60 * 5; i++) game.update(DT, { rudder: 0, sailStep: 0, elevate: -1 });
    expect(game.view().ship.elevation).toBeCloseTo(ELEVATION.min);
    const v = game.view().ship;
    expect(v.arc.port.length).toBeGreaterThan(10);
    expect(v.arc.starboard.length).toBe(v.arc.port.length);
  });

  it('shows a longer arc when the guns are laid higher (in the game)', () => {
    const reach = (elevate: -1 | 1): number => {
      const game = createGame(brig);
      for (let i = 0; i < 60 * 3; i++) game.update(DT, { rudder: 0, sailStep: 0, elevate });
      const v = game.view().ship;
      const last = v.arc.port[v.arc.port.length - 1]!;
      return Math.hypot(last.x - v.x, last.z - v.z);
    };
    expect(reach(1)).toBeGreaterThan(reach(-1) * 1.5);
  });
});

describe('the sea does not throw balls back', () => {
  it('splashes at most once per ball that misses', () => {
    const game = createGame(brig);
    game.update(DT, { rudder: 0, sailStep: 0, fireStarboard: true });
    let splashes = 0;
    for (let i = 0; i < 60 * 6; i++) {
      game.update(DT, { rudder: 0, sailStep: 0 });
      splashes += game.view().events.filter((e) => e.type === 'splash').length;
    }
    expect(splashes).toBeGreaterThan(0);
    expect(splashes).toBeLessThanOrEqual(cannonsPerSide(brig));
  });
});
