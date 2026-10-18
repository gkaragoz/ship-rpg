import type { GameEvent, HitZone } from '../core';
import type { ShipSpec } from '../ships';
import { terrainHeight } from '../world';
import { COMBAT, ballHitZone, ballSpeed, hitNormal, stepBall, type Ball } from './combat';
import { strike } from './damage';
import type { Enemy } from './enemy';
import type { PlayerShip } from './sailing';

/** What a cannonball can meet, and what happens when it does: the game fills this in once per step. */
export interface ShotWorld {
  player: { ship: PlayerShip; spec: ShipSpec; maxHp: number; /** False while moored (safe in harbour) or sunk. */ targetable: boolean };
  enemies: readonly Enemy[];
  rng: () => number;
  /** Height of the sea surface under a point (m). */
  surfaceAt(x: number, z: number): number;
  emit(event: GameEvent): void;
  /** The hull points a hit took off the player, or off one enemy (the game does the bookkeeping: hp, sinking). */
  onPlayerHit(lost: number, zone: HitZone): void;
  onEnemyHit(enemy: Enemy, lost: number): void;
}

/**
 * One ball's step against ships, shore and sea: true when it is spent (it hit a ship, the ground or the sea).
 * A ball that comes down in the sea simply sinks: it splashes once where it lands.
 */
export function resolveBall(b: Ball, w: ShotWorld): boolean {
  if (b.owner === 'enemy') {
    const zone = w.player.targetable ? ballHitZone(b, w.player.ship, w.player.spec) : null;
    if (zone) {
      const lost = strike(w.player.ship, zone, b.damage, w.player.maxHp, w.rng());
      const n = hitNormal(b, w.player.ship);
      w.emit({ type: 'hit', owner: 'enemy', x: b.x, y: b.y, z: b.z, amount: lost, zone, nx: n.x, nz: n.z, speed: ballSpeed(b) });
      w.onPlayerHit(lost, zone);
      return true;
    }
  } else {
    for (const e of w.enemies) {
      const zone = e.sinking < 0 ? ballHitZone(b, e.ship, e.spec) : null;
      if (!zone) continue;
      const lost = strike(e.ship, zone, b.damage, e.maxHp, w.rng());
      const n = hitNormal(b, e.ship);
      w.emit({ type: 'hit', owner: 'player', x: b.x, y: b.y, z: b.z, amount: lost, zone, nx: n.x, nz: n.z, speed: ballSpeed(b) });
      w.onEnemyHit(e, lost);
      return true;
    }
  }
  const ground = terrainHeight(b.x, b.z);
  if (ground > b.y) {
    w.emit({ type: 'splash', owner: b.owner, x: b.x, y: Math.max(0, ground), z: b.z, speed: ballSpeed(b) });
    return true;
  }
  if (b.y > 4) return false;
  const surface = w.surfaceAt(b.x, b.z);
  if (b.y > surface) return false;
  w.emit({ type: 'splash', owner: b.owner, x: b.x, y: surface, z: b.z, speed: ballSpeed(b) });
  return true;
}

/** Sub-steps per frame for the cannonballs: a ball moves ~1.5 m a step, so narrow targets are not skipped. */
const BALL_STEPS = 3;

/** Fly every ball one frame (drag and wind included) and return those still in the air. */
export function flyBalls(balls: readonly Ball[], dt: number, air: { x: number; z: number }, world: ShotWorld): Ball[] {
  const alive: Ball[] = [];
  for (const b of balls) {
    let spent = false;
    for (let k = 0; k < BALL_STEPS && !spent; k++) {
      stepBall(b, dt / BALL_STEPS, air);
      spent = resolveBall(b, world);
    }
    if (!spent && b.age < COMBAT.maxAge) alive.push(b);
  }
  return alive;
}
