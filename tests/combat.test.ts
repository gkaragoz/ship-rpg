import { describe, expect, it } from 'vitest';
import { createRng, type WindView } from '../src/core';
import { createGame } from '../src/gameplay';
import { COMBAT, aimZone, ballHits, cannonsPerSide, fireBroadside, stepBall, targetInZone, type Ball } from '../src/gameplay/combat';
import { FLEE_HULL, LOSE_RANGE, LOSE_SECONDS, MAX_ENEMIES, SPAWN_DISTANCE, aiStep, createEnemy, desiredEnemies, findSpawn, lostTrack, pickEnemySpec } from '../src/gameplay/enemy';
import { SHIP_SPECS } from '../src/ships';
import { terrainHeight } from '../src/world';
import { getShipSpec } from '../src/ships';

const spec = (id: string) => {
  const s = getShipSpec(id);
  if (!s) throw new Error(`${id} missing`);
  return s;
};
const brig = spec('brig');
const DT = 1 / 60;
/** Wind from the north (north is -z, so the wind's origin angle is π/2). */
const northWind: WindView = { from: Math.PI / 2, speed: 8 };

const volley = (heading: number, side: 'port' | 'starboard', speed = 0, seed = 1) => {
  let id = 0;
  return fireBroadside('player', { x: 0, z: 0, heading, speed }, brig, side, createRng(seed), () => ++id);
};

describe('fireBroadside', () => {
  it('fires half the guns per side, capped, and none for an unarmed ship', () => {
    expect(volley(0, 'port').balls).toHaveLength(brig.stats.cannons / 2);
    expect(cannonsPerSide(spec('battleship'))).toBe(COMBAT.maxPerVolley);
    expect(cannonsPerSide(spec('tartane'))).toBe(0);
    const none = fireBroadside('player', { x: 0, z: 0, heading: 0, speed: 0 }, spec('tartane'), 'port', createRng(1), () => 1);
    expect(none.balls).toHaveLength(0);
    expect(none.events).toHaveLength(0);
  });

  it('sends starboard balls to starboard and port balls to port, whatever the heading', () => {
    for (const heading of [0, 1, 2.5, -1.2]) {
      const starboard = { x: Math.sin(heading), z: Math.cos(heading) }; // (sin ψ, cos ψ)
      for (const b of volley(heading, 'starboard').balls) {
        expect((b.vx * starboard.x + b.vz * starboard.z) / COMBAT.ballSpeed).toBeGreaterThan(0.9);
      }
      for (const b of volley(heading, 'port').balls) {
        expect((b.vx * starboard.x + b.vz * starboard.z) / COMBAT.ballSpeed).toBeLessThan(-0.9);
      }
    }
  });

  it('starts at the hull side, spread along its length, and inherits the ship speed', () => {
    const still = volley(0, 'starboard', 0).balls;
    const moving = volley(0, 'starboard', 6).balls;
    const xs = still.map((b) => b.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(brig.length * 0.3);
    for (const b of still) expect(b.z).toBeCloseTo(brig.beam / 2, 5); // heading 0: starboard is +z
    expect(moving[0]!.vx - still[0]!.vx).toBeCloseTo(6, 5); // forward (heading 0) is +x
  });

  it('keeps total firepower when guns exceed the ball cap', () => {
    const b = spec('battleship');
    let id = 0;
    const v = fireBroadside('player', { x: 0, z: 0, heading: 0, speed: 0 }, b, 'port', createRng(1), () => ++id);
    expect(v.balls).toHaveLength(COMBAT.maxPerVolley);
    const total = v.balls.reduce((a, ball) => a + ball.damage, 0);
    expect(total).toBeCloseTo((b.stats.cannons / 2) * b.stats.shot * COMBAT.damagePerLb, 5);
    // A ship under the cap deals exactly calibre × factor per ball.
    expect(volley(0, 'port').balls[0]!.damage).toBeCloseTo(brig.stats.shot * COMBAT.damagePerLb, 5);
  });

  it('is deterministic for a given seed and emits muzzle events', () => {
    expect(volley(0.4, 'port', 0, 7).balls).toEqual(volley(0.4, 'port', 0, 7).balls);
    expect(volley(0.4, 'port', 0, 7).balls).not.toEqual(volley(0.4, 'port', 0, 8).balls);
    const events = volley(0, 'port').events;
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.type === 'fire' && e.owner === 'player')).toBe(true);
  });
});

describe('ballistics', () => {
  it('lands 90–220 m out, fired from rest', () => {
    for (const b of volley(0, 'starboard', 0).balls) {
      const start = { x: b.x, z: b.z };
      for (let i = 0; i < 60 * 6 && b.y > 0; i++) stepBall(b, DT);
      expect(b.y).toBeLessThanOrEqual(0);
      const range = Math.hypot(b.x - start.x, b.z - start.z);
      expect(range).toBeGreaterThan(90);
      expect(range).toBeLessThan(220);
    }
  });
});

describe('ballHits', () => {
  const ball = (x: number, y: number, z: number): Ball => ({ id: 1, owner: 'player', x, y, z, vx: 0, vy: 0, vz: 0, damage: 10, age: 0 });
  const target = { x: 100, z: 50, heading: 0 };

  it('hits inside the hull footprint between keel and rail', () => {
    expect(ballHits(ball(100, 1, 50), target, brig)).toBe(true);
    expect(ballHits(ball(100 + brig.length * 0.49, 1, 50), target, brig)).toBe(true);
  });

  it('misses outside the footprint, above the rigging line or below the keel', () => {
    expect(ballHits(ball(100 + brig.length, 1, 50), target, brig)).toBe(false);
    expect(ballHits(ball(100, 1, 50 + brig.beam), target, brig)).toBe(false);
    expect(ballHits(ball(100, brig.freeboard + 3, 50), target, brig)).toBe(false);
    expect(ballHits(ball(100, -brig.draft - 1, 50), target, brig)).toBe(false);
  });

  it('follows the target heading: a ship turned 90° is long in z', () => {
    const turned = { x: 100, z: 50, heading: Math.PI / 2 };
    expect(ballHits(ball(100, 1, 50 - brig.length * 0.4), turned, brig)).toBe(true);
    expect(ballHits(ball(100 + brig.length * 0.4, 1, 50), turned, brig)).toBe(false);
  });
});

describe('enemy AI', () => {
  it('picks the armed ship closest to 80% of the player hull strength', () => {
    expect(pickEnemySpec(brig).id).toBe('schooner'); // 2000 wanted: schooner 1800 beats xebec 1500
    expect(pickEnemySpec(spec('sloop')).id).toBe('galeoth'); // 960 wanted: galeoth 1000
    expect(pickEnemySpec(spec('battleship')).id).toBe('battleship'); // 8000 wanted: the Battleship itself (10000) is closer than the Frigate (5700)
    expect(pickEnemySpec(spec('tartane')).id).toBe('lugger'); // 80 wanted: weakest armed ship
    for (const id of ['tartane', 'yacht', 'galleon']) expect(pickEnemySpec(spec(id)).stats.cannons).toBeGreaterThanOrEqual(8);
  });

  it('turns toward a distant player and does not fire', () => {
    const e = createEnemy('e', spec('schooner'), 0, 0, 0); // heading east
    // Player due north (north is -z): a left (port) turn is needed, which is a negative rudder.
    const north1 = aiStep(e, { x: 0, z: -2000 }, { from: Math.PI, speed: 8 });
    expect(north1.controls.rudder).toBeLessThan(0);
    expect(north1.fire).toBeNull();
    const south = aiStep(e, { x: 0, z: 2000 }, { from: Math.PI, speed: 8 });
    expect(south.controls.rudder).toBeGreaterThan(0);
  });

  it('fires the broadside that faces the player, only when loaded and in range', () => {
    const e = createEnemy('e', spec('schooner'), 0, 0, 0);
    e.reload.port = 0;
    e.reload.starboard = 0;
    // Heading east: starboard is +z (south), port is -z (northWind). Player 100 m away abeam.
    expect(aiStep(e, { x: 0, z: -100 }, northWind).fire).toBe('port');
    expect(aiStep(e, { x: 0, z: 100 }, northWind).fire).toBe('starboard');
    expect(aiStep(e, { x: 0, z: -400 }, northWind).fire).toBeNull(); // out of range
    expect(aiStep(e, { x: 100, z: 0 }, northWind).fire).toBeNull(); // dead ahead, not abeam
    e.reload.port = 3;
    expect(aiStep(e, { x: 0, z: -100 }, northWind).fire).toBeNull(); // still reloading
  });

  it('bears off rather than steering into the wind', () => {
    const e = createEnemy('e', spec('schooner'), 0, 0, 0);
    // Wind from the east, player far to the east: straight at them is into the wind.
    const r = aiStep(e, { x: 3000, z: 0 }, { from: 0, speed: 8 });
    expect(Math.abs(r.controls.rudder)).toBeGreaterThan(0.2);
  });
});

describe('createGame combat', () => {
  it('starts with one enemy afloat at a distance, full hull and loaded guns', () => {
    const v = createGame(brig).view();
    expect(v.enemies).toHaveLength(1);
    expect(v.enemies[0]!.distance).toBeGreaterThan(400);
    expect(v.enemies[0]!.sinking).toBe(-1);
    expect(v.ship.hp).toBe(brig.stats.hp);
    expect(v.ship.guns).toBe(brig.stats.cannons / 2);
    expect(v.ship.reload).toEqual({ port: 0, starboard: 0 });
    expect(v.sunk).toBe(false);
  });

  it('fires a broadside, reloads over time, and drains events once', () => {
    const game = createGame(brig);
    game.update(DT, { rudder: 0, sailStep: 0, firePort: true });
    const first = game.view();
    expect(first.balls.length).toBe(brig.stats.cannons / 2);
    expect(first.ship.reload.port).toBeGreaterThan(0.9);
    expect(first.events.some((e) => e.type === 'fire' && e.owner === 'player')).toBe(true);
    expect(game.view().events).toHaveLength(0); // drained

    game.update(DT, { rudder: 0, sailStep: 0, firePort: true }); // still reloading
    expect(game.view().balls.length).toBe(brig.stats.cannons / 2);

    for (let i = 0; i < 60 * (COMBAT.playerReload + 1); i++) game.update(DT, { rudder: 0, sailStep: 0 });
    expect(game.view().ship.reload.port).toBe(0);
  });

  it('puts splashes where missed balls land and removes them', () => {
    const game = createGame(brig);
    game.update(DT, { rudder: 0, sailStep: 0, fireStarboard: true });
    let splashes = 0;
    for (let i = 0; i < 60 * 5; i++) {
      game.update(DT, { rudder: 0, sailStep: 0 });
      splashes += game.view().events.filter((e) => e.type === 'splash').length;
    }
    expect(splashes).toBeGreaterThan(0);
    expect(game.view().balls.filter((b) => b.owner === 'player')).toHaveLength(0);
  });

  it('cannot fire while moored or with an unarmed ship', () => {
    const docked = createGame(brig);
    docked.update(DT, { rudder: 0, sailStep: 0, interact: true });
    expect(docked.view().docked).toBe('douwesen'); // the test is only meaningful if we really moored
    docked.update(DT, { rudder: 0, sailStep: 0, firePort: true });
    expect(docked.view().balls.filter((b) => b.owner === 'player')).toHaveLength(0);

    const tartane = createGame(spec('tartane'));
    tartane.update(DT, { rudder: 0, sailStep: 0, firePort: true });
    expect(tartane.view().balls.filter((b) => b.owner === 'player')).toHaveLength(0);
  });

  it('lets the enemy hunt an unarmed ship to death, then restarts cleanly', () => {
    const game = createGame(spec('tartane'));
    let sunkAt = -1;
    let sawHit = 0;
    for (let i = 0; i < 60 * 900 && sunkAt < 0; i++) {
      game.update(DT, { rudder: 0, sailStep: 0 });
      const view = game.view();
      for (const e of view.events) if (e.type === 'hit' && e.owner === 'enemy') sawHit = e.amount ?? 0;
      if (view.sunk) sunkAt = i / 60;
    }
    expect(sunkAt).toBeGreaterThan(0);
    const dead = game.view();
    expect(sawHit).toBe(30); // a Lugger's 12 lb shot: 12 × 2.5 hull points per ball
    expect(dead.ship.hp).toBe(0);

    game.update(DT, { rudder: 0, sailStep: 0, restart: true }); // too soon: must watch it sink first
    expect(game.view().sunk).toBe(true);
    for (let i = 0; i < 60 * 3; i++) game.update(DT, { rudder: 0, sailStep: 0 });
    game.update(DT, { rudder: 0, sailStep: 0, restart: true });
    const fresh = game.view();
    expect(fresh.sunk).toBe(false);
    expect(fresh.ship.hp).toBe(fresh.ship.maxHp);
    expect(fresh.kills).toBe(0);
    expect(fresh.enemies).toHaveLength(1);
  });

  /** Furl the sails so the ship idles near the harbour while the enemy comes to it. */
  const idleUntilHurt = (game: ReturnType<typeof createGame>, maxSeconds: number): number => {
    game.update(DT, { rudder: 0, sailStep: -1 });
    game.update(DT, { rudder: 0, sailStep: -1 });
    for (let i = 0; i < 60 * maxSeconds; i++) {
      game.update(DT, { rudder: 0, sailStep: 0 });
      if (game.view().ship.hp < game.view().ship.maxHp) return i / 60;
    }
    return -1;
  };

  it('repairs a moored ship, and the harbour protects it from enemy fire', () => {
    const game = createGame(brig);
    expect(idleUntilHurt(game, 600)).toBeGreaterThan(0);
    const hurt = game.view().ship.hp;
    expect(hurt).toBeLessThan(brig.stats.hp);

    // Moor: the furled ship has been idling within 80 m of the anchorage.
    expect(game.view().nearestPort?.dockable).toBe(true);
    game.update(DT, { rudder: 0, sailStep: 0, interact: true });
    expect(game.view().docked).not.toBeNull();
    for (let i = 0; i < 60 * 20; i++) game.update(DT, { rudder: 0, sailStep: 0 });
    expect(game.view().ship.hp).toBeGreaterThan(hurt); // repaired, never hit again while moored
    expect(game.view().sunk).toBe(false);
  });
});

describe('aimZone', () => {
  /** Where a fired ball touches the sea, in the ship's frame: forward and starboard distances from its centre. */
  const landing = (b: Ball, from: { x: number; z: number; heading: number }): { fwd: number; stbd: number } => {
    for (let i = 0; i < 480 * 8 && b.y > 0; i++) stepBall(b, 1 / 480);
    const dx = b.x - from.x;
    const dz = b.z - from.z;
    const c = Math.cos(from.heading);
    const s = Math.sin(from.heading);
    return { fwd: dx * c - dz * s, stbd: dx * s + dz * c };
  };

  it.each(['sloop', 'brig', 'galleon', 'battleship'])('%s: every ball of both broadsides lands inside the zone', (id) => {
    const sp = spec(id);
    const from = { x: 120, z: -40, heading: 0.7 };
    const speed = 5;
    const zone = aimZone(sp, speed);
    for (const side of ['starboard', 'port'] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        let n = 0;
        const { balls } = fireBroadside('player', { ...from, speed }, sp, side, createRng(seed), () => ++n);
        for (const b of balls) {
          const l = landing(b, from);
          const across = side === 'starboard' ? l.stbd : -l.stbd;
          expect(across).toBeGreaterThan(zone.near - 1);
          expect(across).toBeLessThan(zone.far + 1);
          expect(l.fwd).toBeGreaterThan(zone.drift - zone.halfSpan - zone.spread - 2);
          expect(l.fwd).toBeLessThan(zone.drift + zone.halfSpan + zone.spread + 2);
        }
      }
    }
  });

  it('starts beside the hull, grows with the ship speed drift and is the same for both sides', () => {
    const z0 = aimZone(brig, 0);
    expect(z0.near).toBeGreaterThan(brig.beam / 2);
    expect(z0.far).toBeGreaterThan(z0.near);
    expect(z0.drift).toBe(0);
    expect(aimZone(brig, 8).drift).toBeGreaterThan(5);
    expect(z0.far - z0.near).toBeGreaterThan(60); // a usefully wide band, per the elevation range
    expect(z0.halfSpan).toBeCloseTo(brig.length * 0.3, 5);
  });
});

describe('targetInZone', () => {
  const zone = aimZone(brig, 0);
  const shooter = { x: 0, z: 0, heading: 0 }; // facing east: starboard is +z (south)
  const mid = (zone.near + zone.far) / 2;

  it('is true for a target abeam within the landing band, on the right side only', () => {
    expect(targetInZone(zone, shooter, 'starboard', { x: 0, z: mid }, 25)).toBe(true);
    expect(targetInZone(zone, shooter, 'port', { x: 0, z: mid }, 25)).toBe(false);
    expect(targetInZone(zone, shooter, 'port', { x: 0, z: -mid }, 25)).toBe(true);
  });

  it('is false when too close, too far or far ahead or astern', () => {
    expect(targetInZone(zone, shooter, 'starboard', { x: 0, z: zone.near - 40 }, 25)).toBe(false);
    expect(targetInZone(zone, shooter, 'starboard', { x: 0, z: zone.far + 60 }, 25)).toBe(false);
    expect(targetInZone(zone, shooter, 'starboard', { x: 200, z: mid }, 25)).toBe(false);
    expect(targetInZone(zone, shooter, 'starboard', { x: -200, z: mid }, 25)).toBe(false);
  });

  it('follows the shooter heading: facing north the starboard side is east (+x)', () => {
    const north = { x: 0, z: 0, heading: Math.PI / 2 }; // forward (0, -1), starboard (1, 0)
    expect(targetInZone(zone, north, 'starboard', { x: mid, z: 0 }, 25)).toBe(true);
    expect(targetInZone(zone, north, 'starboard', { x: -mid, z: 0 }, 25)).toBe(false);
  });

  it('is reported in the game view when an enemy sits in a zone', () => {
    const v = createGame(brig).view();
    expect(v.ship.inRange).toEqual({ port: false, starboard: false }); // the enemy starts 650 m away
    expect(v.ship.aim.side).toBeCloseTo(brig.beam / 2, 5);
  });
});

describe('targetInZone edges', () => {
  const shooter = { x: 0, z: 0, heading: 0 };

  it('moves the zone forward with the ship speed', () => {
    const fast = aimZone(brig, 10);
    const mid = (fast.near + fast.far) / 2;
    // A target just ahead of the beam is inside only because the ship's speed carries the shot forward.
    const ahead = fast.drift + fast.halfSpan * 0.5;
    expect(targetInZone(fast, shooter, 'starboard', { x: ahead, z: mid }, 25)).toBe(true);
    const still = aimZone(brig, 0);
    expect(targetInZone(still, shooter, 'starboard', { x: fast.drift + still.halfSpan + 40, z: mid }, 25)).toBe(false);
  });

  it('gives an unarmed ship a zone too (callers decide whether it can fire)', () => {
    const z = aimZone(spec('tartane'), 0);
    expect(z.far).toBeGreaterThan(z.near);
    expect(cannonsPerSide(spec('tartane'))).toBe(0);
  });

  it('is false for a target directly astern or ahead on the centreline', () => {
    const z = aimZone(brig, 0);
    expect(targetInZone(z, shooter, 'starboard', { x: -150, z: 0 }, 25)).toBe(false);
    expect(targetInZone(z, shooter, 'port', { x: 150, z: 0 }, 25)).toBe(false);
  });
});

describe('enemy fleeing and losing track', () => {
  const schooner = spec('schooner');

  it('breaks off below the flee threshold and keeps running even if repaired', () => {
    const atLine = Math.ceil(schooner.stats.hp * 0.7 * FLEE_HULL); // enemy hull is 70% of the listed value
    const e = createEnemy('e', schooner, 0, 0, 0);
    expect(e.maxHp * FLEE_HULL).toBeLessThanOrEqual(atLine);
    e.hp = atLine; // at or just above 25%: still fighting
    aiStep(e, { x: 0, z: -2000 }, northWind);
    expect(e.fleeing).toBe(false);

    e.hp = atLine - 1; // just below: breaks off
    aiStep(e, { x: 0, z: -2000 }, northWind);
    expect(e.fleeing).toBe(true);

    e.hp = e.maxHp; // repaired: still running
    aiStep(e, { x: 0, z: -2000 }, northWind);
    expect(e.fleeing).toBe(true);
  });

  it('runs away from the player instead of closing in, and does not fire', () => {
    const e = createEnemy('e', schooner, 0, 0, 0); // heading east
    e.hp = 10;
    e.reload.port = 0;
    e.reload.starboard = 0;
    // Player 100 m due north (abeam to port): a healthy enemy would fire; this one turns south, away (a starboard turn).
    const r = aiStep(e, { x: 0, z: -100 }, northWind);
    expect(r.fire).toBeNull();
    expect(r.controls.rudder).toBeGreaterThan(0.5);
  });

  it('gives up only after the player has been out of range for the full time', () => {
    const e = createEnemy('e', schooner, 0, 0, 0);
    const far = LOSE_RANGE + 100;
    let lost = false;
    for (let i = 0; i < 60 * (LOSE_SECONDS - 1); i++) lost = lostTrack(e, far, 1 / 60);
    expect(lost).toBe(false);
    expect(e.lostFor).toBeGreaterThan(LOSE_SECONDS - 1.1); // it really was counting
    // Closing back inside the range starts the count over.
    expect(lostTrack(e, LOSE_RANGE - 100, 1 / 60)).toBe(false);
    expect(e.lostFor).toBe(0);
    for (let i = 0; i < 60 * LOSE_SECONDS + 1; i++) lost = lostTrack(e, far, 1 / 60);
    expect(lost).toBe(true);
  });
});

describe('several enemies', () => {
  it('adds one enemy per two kills, up to the maximum', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 50].map(desiredEnemies)).toEqual([1, 1, 2, 2, 3, 3, MAX_ENEMIES, MAX_ENEMIES]);
    expect(MAX_ENEMIES).toBe(3);
  });

  it('picks a mixed squadron: rank 0 is the closest match, the next ranks are other armed ships', () => {
    const squad = [0, 1, 2].map((r) => pickEnemySpec(brig, r));
    expect(squad[0]).toBe(pickEnemySpec(brig));
    expect(new Set(squad.map((s) => s.id)).size).toBe(3);
    for (const s of squad) expect(s.stats.cannons).toBeGreaterThanOrEqual(8);
    // Closeness to 80% of the player's hull strength never gets better with the rank.
    const gap = (s: { stats: { hp: number } }): number => Math.abs(s.stats.hp - brig.stats.hp * 0.8);
    expect(gap(squad[0]!)).toBeLessThanOrEqual(gap(squad[1]!));
    expect(gap(squad[1]!)).toBeLessThanOrEqual(gap(squad[2]!));
  });

  it('steers away from an enemy that is too close, and ignores distant ones', () => {
    const e = createEnemy('e', spec('schooner'), 0, 0, 0); // heading east
    const player = { x: 3000, z: 0 };
    const calm = aiStep(e, player, { from: Math.PI, speed: 8 }, []);
    // A neighbour 40 m dead ahead: head away from it (west), which is a hard turn.
    const crowded = aiStep(e, player, { from: Math.PI, speed: 8 }, [{ x: 40, z: 0 }]);
    expect(Math.abs(crowded.controls.rudder)).toBeGreaterThan(Math.abs(calm.controls.rudder));
    const farAway = aiStep(e, player, { from: Math.PI, speed: 8 }, [{ x: 500, z: 0 }]);
    expect(farAway.controls.rudder).toBe(calm.controls.rudder);
  });
});

describe('squadrons for every ship', () => {
  it.each(SHIP_SPECS.map((p) => [p.id, p] as const))('%s faces three distinct armed ships, closest match first', (_id, player) => {
    const squad = [0, 1, 2].map((r) => pickEnemySpec(player, r));
    expect(new Set(squad.map((s) => s.id)).size).toBe(3);
    for (const s of squad) expect(s.stats.cannons).toBeGreaterThanOrEqual(8);
    const gap = (s: { stats: { hp: number } }): number => Math.abs(s.stats.hp - player.stats.hp * 0.8);
    expect(gap(squad[0]!)).toBeLessThanOrEqual(gap(squad[1]!));
    expect(gap(squad[1]!)).toBeLessThanOrEqual(gap(squad[2]!));
    const armed = SHIP_SPECS.filter((x) => x.stats.cannons >= 8).length;
    expect(pickEnemySpec(player, armed).id).toBe(squad[0]!.id); // ranks wrap around the armed list
  });
});

describe('findSpawn', () => {
  const player = { x: 40000, z: 40000, heading: 0.4 }; // open sea, far from every island
  const rng = createRng(3);

  it('first tries dead ahead, at the spawn distance, in water deep enough', () => {
    const at = findSpawn(player, spec('schooner'), rng, [])!;
    expect(at.angle).toBe(player.heading);
    expect(Math.hypot(at.x - player.x, at.z - player.z)).toBeCloseTo(SPAWN_DISTANCE, 5);
    expect(terrainHeight(at.x, at.z)).toBeLessThan(-spec('schooner').draft - 8);
  });

  it('moves to another bearing rather than spawn on top of an enemy already there', () => {
    const ahead = findSpawn(player, spec('schooner'), createRng(1), [])!;
    const second = findSpawn(player, spec('schooner'), createRng(1), [{ x: ahead.x + 20, z: ahead.z }])!;
    expect(second.angle).not.toBe(player.heading);
    expect(Math.hypot(second.x - ahead.x, second.z - ahead.z)).toBeGreaterThan(100);
  });

  it('returns null when no water is deep enough for the keel', () => {
    const impossible = { ...spec('schooner'), draft: 100 }; // deeper than any sea in the world (60 m)
    expect(findSpawn(player, impossible, createRng(1), [])).toBeNull();
  });
});

describe('separation never overrides the wind', () => {
  it('still bears off the wind when the way away from a neighbour points into it', () => {
    const e = createEnemy('e', spec('schooner'), 0, 0, 0); // heading east
    const eastWind: WindView = { from: 0, speed: 8 }; // wind from the east: east is dead into it
    const player = { x: -3000, z: 0 }; // far to the west
    // Neighbour 40 m to the west: away from it is east, straight into the wind.
    const r = aiStep(e, player, eastWind, [{ x: -40, z: 0 }]);
    expect(Math.abs(r.controls.rudder)).toBeGreaterThan(0.2);
  });
});
