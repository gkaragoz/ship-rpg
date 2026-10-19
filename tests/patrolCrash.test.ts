import { describe, expect, it } from 'vitest';
import { getShipSpec } from '../src/ships';
import { createNpcFleet, PATROL_RECOVERY } from '../src/gameplay/npcShips';
import { stepCrashes } from '../src/gameplay/crashes';
import { collideAll, type Hull } from '../src/gameplay/collision';
import { createPlayerShip } from '../src/gameplay/sailing';
import { SHAKE, addShake, decayShake } from '../src/render/shake';
import { COURSE, type GameEvent, type OtherShipView } from '../src/core';

const spec = (id: string) => {
  const s = getShipSpec(id);
  if (!s) throw new Error(`no ${id}`);
  return s;
};
const brig = spec('brig');
const OPEN = { x: -9000, z: -9000 };

describe('patrols that are shoved', () => {
  it('are pushed off their rail by a nudge and sail back onto it', () => {
    const fleet = createNpcFleet({ x: 0, z: 0 });
    const before = fleet.view()[0]!;
    fleet.nudge(0, 12, -7, 0.3);
    const shoved = fleet.view()[0]!;
    expect(shoved.x - before.x).toBeCloseTo(12);
    expect(shoved.z - before.z).toBeCloseTo(-7);
    // the bow never snaps: it follows the way the shoved ship goes, at a limited turn rate
    expect(shoved.heading).toBe(before.heading);
    fleet.update(1 / 60);
    expect(Math.abs(fleet.view()[0]!.heading - before.heading)).toBeLessThanOrEqual(COURSE.turnRate / 60 + 0.01);
    // The rail itself moves on, so compare with a fleet that was never shoved, after a few recovery times.
    const calm = createNpcFleet({ x: 0, z: 0 });
    for (let i = 0; i < 60 * PATROL_RECOVERY * 3; i++) {
      fleet.update(1 / 60);
      calm.update(1 / 60);
    }
    const back = fleet.view()[0]!;
    const rail = calm.view()[0]!;
    expect(Math.hypot(back.x - rail.x, back.z - rail.z)).toBeLessThan(1);
    expect(Math.abs(back.heading - rail.heading)).toBeLessThan(0.05);
    expect(Math.hypot(shoved.x - rail.x, shoved.z - rail.z)).toBeGreaterThan(0); // (it was away at first)
  });

  it('ignores a nudge for a patrol that does not exist', () => {
    const fleet = createNpcFleet({ x: 0, z: 0 });
    expect(() => fleet.nudge(999, 5, 5, 1)).not.toThrow();
  });
});

describe('a ship that meets a patrol', () => {
  const patrolAt = (specId: string, dx: number): OtherShipView => ({ id: 3, specId, x: OPEN.x + dx, z: OPEN.z, heading: 0, sailLevel: 1, roll: 0, apparent: { angle: 0, speed: 0 } });

  const crash = (specId: string): { dx: number; nudged: boolean } => {
    const ship = createPlayerShip(OPEN.x, OPEN.z, 0);
    ship.speed = 6;
    const nudges: { id: number; dx: number }[] = [];
    stepCrashes({ ship, spec: brig, maxHp: brig.stats.hp, active: true }, [], [patrolAt(specId, 18)], (id, dx) => nudges.push({ id, dx }));
    return { dx: nudges[0]?.dx ?? 0, nudged: nudges.length > 0 };
  };

  it('shoves it forward (it was in the way), the more so the lighter it is, and the patrol takes no damage', () => {
    const light = crash('sloop');
    const heavy = crash('battleship');
    expect(light.nudged).toBe(true);
    expect(light.dx).toBeGreaterThan(0);
    expect(light.dx).toBeGreaterThan(heavy.dx);
    const ship = createPlayerShip(OPEN.x, OPEN.z, 0);
    ship.speed = 6;
    const r = stepCrashes({ ship, spec: brig, maxHp: brig.stats.hp, active: true }, [], [patrolAt('sloop', 18)], () => undefined);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ type: 'collision', owner: 'player' });
  });
});

describe('patrols among themselves', () => {
  it('never collide with each other, however they cross', () => {
    const a: Hull = { ship: { x: 0, z: 0, heading: 0, speed: 5 }, spec: brig, maxHp: 0, group: 'patrol' };
    const b: Hull = { ship: { x: 5, z: 0, heading: Math.PI, speed: 5 }, spec: brig, maxHp: 0, group: 'patrol' };
    expect(collideAll([a, b])).toHaveLength(0);
    expect(a.ship.x).toBe(0);
    expect(b.ship.x).toBe(5);
  });
});

describe('camera shake', () => {
  const ev = (over: Partial<GameEvent>): GameEvent => ({ type: 'collision', owner: 'player', x: 0, y: 0, z: 0, ...over });

  it('is small for a crash and stays under its cap however hard the blow', () => {
    const soft = addShake(0, [ev({ speed: 2 })]);
    const hard = addShake(0, [ev({ speed: 12 })]);
    expect(hard).toBeGreaterThan(soft);
    expect(hard).toBeLessThanOrEqual(SHAKE.crash.max);
    expect(addShake(0, [ev({ speed: 12 }), ev({ speed: 12 }), ev({ speed: 12 })])).toBeLessThanOrEqual(SHAKE.crash.max);
    expect(SHAKE.crash.max * SHAKE.offset).toBeLessThan(0.3); // the camera moves a few decimetres at most
  });

  it('shakes for the player only, a little for each gun, and dies away within a fraction of a second', () => {
    expect(addShake(0, [ev({ owner: 'enemy', speed: 8 })])).toBe(0);
    const volley = addShake(0, Array.from({ length: 24 }, () => ev({ type: 'fire' })));
    expect(volley).toBeGreaterThan(0);
    expect(volley).toBeLessThanOrEqual(SHAKE.fire.max);
    let s = addShake(0, [ev({ speed: 12 })]);
    for (let i = 0; i < 60; i++) s = decayShake(s, 1 / 60); // one second
    expect(s).toBe(0);
  });

  it('shakes a hit on the player by the hull points it took, up to its cap', () => {
    const light = addShake(0, [ev({ type: 'hit', owner: 'enemy', amount: 10 })]);
    const heavy = addShake(0, [ev({ type: 'hit', owner: 'enemy', amount: 500 })]);
    expect(heavy).toBeGreaterThan(light);
    expect(heavy).toBeLessThanOrEqual(SHAKE.hit.max);
  });
});
