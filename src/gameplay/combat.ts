import type { GameEvent, Owner } from '../core';
import { lerp } from '../core';
import type { ShipSpec } from '../ships';

export type Side = 'port' | 'starboard';

export interface Ball {
  id: number;
  owner: Owner;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  age: number;
}

/** What a ship needs to fire or be hit: position, heading, speed. */
export interface Hull {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

export const COMBAT = {
  /** Muzzle speed, m/s. With the elevation range below shots land 100–200 m out. */
  ballSpeed: 90,
  gravity: 9.81,
  /** Random sideways spread and elevation range, radians. */
  yawJitter: 0.035,
  elevationMin: 0.05,
  elevationMax: 0.11,
  /** At most this many balls per broadside; guns beyond it add damage to the balls instead. */
  maxPerVolley: 24,
  /** Hit points per pound of shot. */
  damagePerLb: 2.5,
  /** Seconds to reload a broadside. */
  playerReload: 6,
  enemyReload: 10,
  /** The enemy's sideways spread is this many times the player's, until the player has an aim aid. */
  enemySpread: 1.6,
  /** Balls older than this are dropped. */
  maxAge: 6,
} as const;

export const cannonsPerSide = (spec: ShipSpec): number => Math.min(COMBAT.maxPerVolley, Math.floor(spec.stats.cannons / 2));

/**
 * Fire one broadside. Forward is (cos ψ, -sin ψ) and starboard is (sin ψ, cos ψ) in (x, z).
 * Balls inherit the ship's speed, spread along the hull and fan out slightly.
 */
export function fireBroadside(
  owner: Owner,
  hull: Hull,
  spec: ShipSpec,
  side: Side,
  rng: () => number,
  nextId: () => number,
): { balls: Ball[]; events: GameEvent[] } {
  const n = cannonsPerSide(spec);
  const balls: Ball[] = [];
  const events: GameEvent[] = [];
  if (n === 0) return { balls, events };

  const c = Math.cos(hull.heading);
  const s = Math.sin(hull.heading);
  const sign = side === 'starboard' ? 1 : -1;
  const dirX = s * sign;
  const dirZ = c * sign;
  const y = Math.max(1.2, spec.freeboard - 0.8);
  // Keep a big ship's firepower when its guns exceed the ball cap: heavier hits, same total.
  const damage = spec.stats.shot * COMBAT.damagePerLb * (spec.stats.cannons / 2 / n);

  for (let i = 0; i < n; i++) {
    const along = (-0.3 + (0.6 * (i + 0.5)) / n) * spec.length;
    const px = hull.x + c * along + dirX * (spec.beam / 2);
    const pz = hull.z - s * along + dirZ * (spec.beam / 2);
    const yaw = (rng() * 2 - 1) * COMBAT.yawJitter * (owner === 'enemy' ? COMBAT.enemySpread : 1);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const elev = lerp(COMBAT.elevationMin, COMBAT.elevationMax, rng());
    const horizontal = COMBAT.ballSpeed * Math.cos(elev);
    balls.push({
      id: nextId(),
      owner,
      x: px,
      y,
      z: pz,
      vx: (dirX * cy - dirZ * sy) * horizontal + c * hull.speed,
      vy: COMBAT.ballSpeed * Math.sin(elev),
      vz: (dirX * sy + dirZ * cy) * horizontal - s * hull.speed,
      damage,
      age: 0,
    });
    if (i % Math.max(1, Math.floor(n / 4)) === 0) events.push({ type: 'fire', owner, x: px, y, z: pz });
  }
  return { balls, events };
}

export function stepBall(b: Ball, dt: number): void {
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  b.vy -= COMBAT.gravity * dt;
  b.age += dt;
}

/** True if the ball is inside the target's hull footprint, between keel and rail (plus rigging height). */
export function ballHits(b: Ball, target: Pick<Hull, 'x' | 'z' | 'heading'>, spec: ShipSpec): boolean {
  const dx = b.x - target.x;
  const dz = b.z - target.z;
  const c = Math.cos(target.heading);
  const s = Math.sin(target.heading);
  const along = dx * c - dz * s;
  const across = dx * s + dz * c;
  return (
    Math.abs(along) < spec.length / 2 &&
    Math.abs(across) < spec.beam / 2 &&
    b.y > -spec.draft &&
    b.y < spec.freeboard + 1.5
  );
}
