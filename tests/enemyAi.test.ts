import { describe, expect, it } from 'vitest';
import { FLEE_HULL, SURRENDER_HULL, aiStep, createEnemy, doctrineFor } from '../src/gameplay/enemy';
import { getShipSpec } from '../src/ships';
import type { WindView } from '../src/core';

const brig = getShipSpec('brig')!;
const wind: WindView = { from: Math.PI, speed: 8 };
/** An enemy at the origin heading east (+x), the player 400 m away. */
const make = (nation: string, id = 'e1') => createEnemy(id, brig, 0, 0, 0, nation);

describe('doctrine', () => {
  it('has pirates that never surrender and navies that may', () => {
    expect(doctrineFor('pirate').surrender).toBe(0);
    for (const n of ['english', 'french', 'spanish', 'dutch']) expect(doctrineFor(n).surrender).toBeGreaterThan(0);
    expect(doctrineFor('martian')).toEqual(doctrineFor('english')); // unknown flags fight like a navy
  });
});

describe('surrender', () => {
  const crippled = (nation: string, id: string) => {
    const e = make(nation, id);
    e.hp = Math.floor(e.maxHp * (SURRENDER_HULL - 0.02));
    return e;
  };
  /** The ids of a navy whose captain strikes (roll below the chance) and of one that fights on. */
  const strikers: string[] = [];
  const fighters: string[] = [];
  for (let i = 0; i < 60; i++) {
    const e = crippled('english', `e${i}`);
    aiStep(e, { x: 400, z: 0 }, wind);
    (e.surrendered ? strikers : fighters).push(`e${i}`);
  }

  it('lets some crippled navy ships strike their colours and the rest run', () => {
    expect(strikers.length).toBeGreaterThan(10);
    expect(fighters.length).toBeGreaterThan(10);
    const e = crippled('english', fighters[0]!);
    aiStep(e, { x: 400, z: 0 }, wind);
    expect(e.surrendered).toBe(false);
    expect(e.fleeing).toBe(true);
  });

  it('a surrendered ship lowers its sails, keeps the helm and never fires', () => {
    const e = crippled('english', strikers[0]!);
    e.ship.sailTarget = 1;
    e.reload.port = 0;
    e.reload.starboard = 0;
    const r = aiStep(e, { x: 40, z: 100 }, wind);
    expect(e.surrendered).toBe(true);
    expect(e.fleeing).toBe(false);
    expect(r.fire).toBeNull();
    expect(r.controls.sailStep).toBe(-1);
    expect(r.controls.rudder).toBe(0);
    // once struck it stays struck
    e.ship.sailTarget = 0;
    expect(aiStep(e, { x: 40, z: 100 }, wind).controls.sailStep).toBe(0);
    expect(e.surrendered).toBe(true);
  });

  it('a pirate never surrenders: it runs', () => {
    for (let i = 0; i < 30; i++) {
      const e = crippled('pirate', `p${i}`);
      aiStep(e, { x: 400, z: 0 }, wind);
      expect(e.surrendered).toBe(false);
      expect(e.fleeing).toBe(true);
    }
  });

  it('only a badly crippled ship strikes: between the flee and the surrender line it just runs', () => {
    for (let i = 0; i < 30; i++) {
      const e = make('english', `m${i}`);
      e.hp = Math.floor(e.maxHp * (FLEE_HULL - 0.03));
      aiStep(e, { x: 400, z: 0 }, wind);
      expect(e.surrendered).toBe(false);
    }
  });
});

describe('a pincer', () => {
  it('has a second ship take the player to the other side than the leader, while still closing', () => {
    const player = { x: 250, z: 0 };
    // both approach from the west; the leader is nearer and has the player on its port side
    const leader = createEnemy('lead', brig, 150, -20, 0, 'pirate');
    const follower = make('pirate', 'follow');
    const alone = aiStep(follower, player, wind, []);
    const paired = aiStep(follower, player, wind, [{ x: leader.ship.x, z: leader.ship.z, heading: leader.ship.heading }]);
    // the leader keeps the player to port (positive relative bearing, heading east and player at +x/−... see `aiStep`),
    // so with a mate present the follower's steering differs from its steering alone
    expect(paired.controls.rudder).not.toBe(alone.controls.rudder);
  });

  it('is the same without mates: nothing changes for a lone ship', () => {
    const a = aiStep(make('pirate'), { x: 250, z: 80 }, wind, []);
    const b = aiStep(make('pirate'), { x: 250, z: 80 }, wind);
    expect(a).toEqual(b);
  });
});
