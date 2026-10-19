import { describe, expect, it } from 'vitest';
import { getShipSpec } from '../src/ships';
import { COLLISION, collide, collideAll, hullMass, overlap, type Hull } from '../src/gameplay/collision';
import { stepCrashes } from '../src/gameplay/crashes';
import { createEnemy } from '../src/gameplay/enemy';
import { SAILING, createPlayerShip, stepPlayerShip, type PlayerShip } from '../src/gameplay/sailing';

const spec = (id: string) => {
  const s = getShipSpec(id);
  if (!s) throw new Error(`no ${id}`);
  return s;
};
// Open water far from any island, ships facing +x (heading 0) or -x (heading pi).
const OPEN = { x: -9000, z: -9000 };
const hull = (id: string, dx: number, heading: number, speed: number): Hull & { ship: PlayerShip } => {
  const s = spec(id);
  const ship = createPlayerShip(OPEN.x + dx, OPEN.z, heading);
  ship.speed = speed;
  return { ship, spec: s, maxHp: s.stats.hp };
};

describe('hull boxes', () => {
  it('overlap only when they touch, also when turned', () => {
    const a = hull('brig', 0, 0, 0);
    const far = hull('brig', 200, 0, 0);
    const close = hull('brig', 14, Math.PI / 2, 0);
    const box = (h: Hull) => {
      const c = Math.cos(h.ship.heading);
      const s = Math.sin(h.ship.heading);
      return { x: h.ship.x, z: h.ship.z, fx: c, fz: -s, sx: s, sz: c, hl: h.spec.length * COLLISION.lengthFit, hb: h.spec.beam * COLLISION.beamFit };
    };
    expect(overlap(box(a), box(far))).toBeNull();
    const hit = overlap(box(a), box(close));
    expect(hit).not.toBeNull();
    expect(hit!.depth).toBeGreaterThan(0);
    expect(Math.hypot(hit!.nx, hit!.nz)).toBeCloseTo(1);
  });

  it('weighs a battleship far more than a tartane', () => {
    expect(hullMass(spec('battleship'))).toBeGreaterThan(hullMass(spec('tartane')) * 50);
  });
});

describe('a crash', () => {
  it('pushes the hulls apart and takes speed from a head-on pair', () => {
    const a = hull('brig', 0, 0, 6);
    const b = hull('brig', 22, Math.PI, 6);
    const r = collide(a, b)!;
    expect(r).not.toBeNull();
    expect(r.speed).toBeCloseTo(12, 0);
    expect(a.ship.speed).toBeLessThan(6);
    expect(b.ship.speed).toBeLessThan(6);
    expect(overlap(
      { x: a.ship.x, z: a.ship.z, fx: 1, fz: 0, sx: 0, sz: 1, hl: a.spec.length * COLLISION.lengthFit, hb: a.spec.beam * COLLISION.beamFit },
      { x: b.ship.x, z: b.ship.z, fx: -1, fz: 0, sx: 0, sz: -1, hl: b.spec.length * COLLISION.lengthFit, hb: b.spec.beam * COLLISION.beamFit },
    )).toBeNull();
    expect(r.lostA).toBeGreaterThan(0);
    expect(r.lostA).toBeCloseTo(r.lostB, 5);
  });

  it('hurts the small ship far more than the big one it rams', () => {
    const big = hull('battleship', 0, 0, 5);
    const small = hull('tartane', 33, Math.PI, 0);
    const r = collide(big, small)!;
    expect(r.lostB / small.maxHp).toBeGreaterThan((r.lostA / big.maxHp) * 20);
    expect(big.ship.speed).toBeGreaterThan(3); // the big ship barely notices
  });

  it('only scrapes below the scrape speed: no damage', () => {
    const a = hull('brig', 0, 0, 0.6);
    const b = hull('brig', 22, 0, 0);
    const r = collide(a, b)!;
    expect(r.lostA).toBe(0);
    expect(r.lostB).toBe(0);
  });

  it('opens the hull below the waterline only in a hard blow', () => {
    const soft = collide(hull('brig', 0, 0, 2), hull('brig', 22, 0, 0))!;
    const hard = collide(hull('brig', 0, 0, 7), hull('brig', 22, 0, 0))!;
    expect(soft.holed).toBe(false);
    expect(hard.holed).toBe(true);
  });

  it('swings the bow of a ship hit off-centre', () => {
    const a = hull('brig', 0, 0, 6);
    const b = hull('brig', 26, 0, 0);
    b.ship.z += 1.5; // hit on the quarter, not dead astern
    const before = b.ship.heading;
    collide(a, b);
    // the bow does not snap round: the blow becomes a yaw rate that the water damps out (see `stepPlayerShip`)
    expect(b.ship.heading).toBe(before);
    expect(b.ship.spin).not.toBe(0);
    expect(Math.abs(b.ship.spin)).toBeLessThanOrEqual(COLLISION.maxSpin + 1e-9);
    // the whole swing, once the spin has died away, is at most what one contact may turn the ship
    expect(Math.abs(b.ship.spin) * SAILING.spinDecay).toBeLessThanOrEqual(COLLISION.maxSwing + 1e-9);
  });

  it('swings the bow over a moment and then lets it settle, instead of snapping the heading', () => {
    const a = hull('brig', 0, 0, 6);
    const b = hull('brig', 26, 0, 0);
    b.ship.z += 1.5;
    collide(a, b);
    const total = b.ship.spin * SAILING.spinDecay;
    const wind = { from: 0, speed: 0 };
    let steps = 0;
    let biggest = 0;
    let last = b.ship.heading;
    for (let i = 0; i < 60 * 6; i++) {
      stepPlayerShip(b.ship, spec('brig'), wind, { rudder: 0, sailStep: 0 }, 1 / 60);
      biggest = Math.max(biggest, Math.abs(b.ship.heading - last));
      last = b.ship.heading;
      steps++;
    }
    expect(steps).toBeGreaterThan(0);
    expect(biggest).toBeLessThan(Math.abs(total) / 10); // no frame turns more than a tenth of the swing
    expect(b.ship.heading).toBeCloseTo(total, 1); // and the bow ends up where the blow sent it
    expect(b.ship.spin).toBe(0);
  });

  it('never moves a patrol, which only bounces the ship that meets it', () => {
    const player = hull('brig', 0, 0, 6);
    const s = spec('sloop');
    const patrol: Hull = { ship: { x: OPEN.x + 20, z: OPEN.z, heading: 0, speed: 5 }, spec: s, maxHp: 1, fixed: { vx: 5, vz: 0 } };
    collide(player, patrol);
    expect(patrol.ship.x).toBe(OPEN.x + 20);
    expect(player.ship.speed).toBeLessThan(6);
  });

  it('stays stable when a ship keeps driving into another (no overlap left, nothing blows up)', () => {
    const a = hull('brig', 0, 0, 7);
    const b = hull('galleon', 40, Math.PI, 0);
    for (let i = 0; i < 600; i++) {
      a.ship.speed = Math.max(a.ship.speed, 5); // the sails keep pushing
      a.ship.x += Math.cos(a.ship.heading) * a.ship.speed / 60;
      collideAll([a, b]);
    }
    for (const h of [a, b]) {
      expect(Number.isFinite(h.ship.x + h.ship.z + h.ship.heading + h.ship.speed)).toBe(true);
    }
    expect(Math.hypot(a.ship.x - b.ship.x, a.ship.z - b.ship.z)).toBeGreaterThan(20);
  });
});

describe('crashes in the game', () => {
  it('reports the player ramming an enemy, with damage to both and a collision event', () => {
    const brig = spec('brig');
    const player = createPlayerShip(OPEN.x, OPEN.z, 0);
    player.speed = 6;
    const enemy = createEnemy('e1', brig, OPEN.x + 22, OPEN.z, Math.PI);
    const r = stepCrashes({ ship: player, spec: brig, maxHp: brig.stats.hp, active: true }, [enemy], []);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ type: 'collision', owner: 'player' });
    expect(r.playerLost).toBeGreaterThan(0);
    expect(r.enemyLost[0]).toBeGreaterThan(0);
  });

  it('ignores a moored player and sinking enemies', () => {
    const brig = spec('brig');
    const player = createPlayerShip(OPEN.x, OPEN.z, 0);
    const enemy = createEnemy('e1', brig, OPEN.x + 10, OPEN.z, Math.PI);
    expect(stepCrashes({ ship: player, spec: brig, maxHp: brig.stats.hp, active: false }, [enemy], []).events).toHaveLength(0);
    enemy.sinking = 1;
    expect(stepCrashes({ ship: player, spec: brig, maxHp: brig.stats.hp, active: true }, [enemy], []).events).toHaveLength(0);
  });
});

describe('crash events', () => {
  it('make no event for a touch below the scrape speed, and none for a sunk or moored player', () => {
    const brig = spec('brig');
    const player = createPlayerShip(OPEN.x, OPEN.z, 0);
    player.speed = 0.4;
    const enemy = createEnemy('e1', brig, OPEN.x + 22, OPEN.z, Math.PI);
    enemy.ship.speed = 0;
    const r = stepCrashes({ ship: player, spec: brig, maxHp: brig.stats.hp, active: true }, [enemy], []);
    expect(r.events).toHaveLength(0);
    expect(r.playerLost).toBe(0);
  });

  it('swings a ship hit on the quarter away from the blow (the bow turns the other way)', () => {
    const a = hull('brig', 0, 0, 6);
    const b = hull('brig', 26, 0, 0);
    b.ship.z += 1.5; // struck 1.5 m to starboard of its centre line (z is starboard when heading is 0)
    collide(a, b);
    const toStarboardStrike = b.ship.spin;
    const c = hull('brig', 0, 0, 6);
    const d = hull('brig', 26, 0, 0);
    d.ship.z -= 1.5;
    collide(c, d);
    expect(Math.sign(d.ship.spin)).toBe(-Math.sign(toStarboardStrike));
  });
});
