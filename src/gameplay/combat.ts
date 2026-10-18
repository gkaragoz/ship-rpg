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
  /** The enemy's sideways spread is this many times the player's (a handicap kept until the balance table, see ROADMAP 5a.4). */
  enemySpread: 1.6,
  /** Balls older than this are dropped. */
  maxAge: 6,
} as const;

/** Muzzle height above the sea. */
export const muzzleHeight = (spec: ShipSpec): number => Math.max(1.2, spec.freeboard - 0.8);

export interface AimZone {
  /** Distance from the centreline to the muzzles (half the beam). */
  side: number;
  /** Distances from the ship's centreline (m) between which balls land abeam. */
  near: number;
  far: number;
  /** Half the length (m) along the hull over which the guns are spread. */
  halfSpan: number;
  /** How far forward (m) the ship's own speed carries the landing zone. */
  drift: number;
  /** Extra sideways scatter (m) at the far edge. */
  spread: number;
}

/** Seconds a ball fired at `elev` takes to come down to the sea from the muzzle. */
const flightTime = (elev: number, y: number): number => {
  const vy = COMBAT.ballSpeed * Math.sin(elev);
  return (vy + Math.sqrt(vy * vy + 2 * COMBAT.gravity * y)) / COMBAT.gravity;
};

/** Where a broadside lands, from the same ballistics `fireBroadside` uses (see tests). */
export function aimZone(spec: ShipSpec, shipSpeed: number): AimZone {
  const y = muzzleHeight(spec);
  const lo = flightTime(COMBAT.elevationMin, y);
  const hi = flightTime(COMBAT.elevationMax, y);
  const range = (elev: number, t: number): number => COMBAT.ballSpeed * Math.cos(elev) * t;
  const near = range(COMBAT.elevationMin, lo);
  const far = range(COMBAT.elevationMax, hi);
  return {
    side: spec.beam / 2,
    near: spec.beam / 2 + near,
    far: spec.beam / 2 + far,
    halfSpan: 0.3 * spec.length,
    drift: shipSpeed * ((lo + hi) / 2),
    spread: Math.tan(COMBAT.yawJitter) * far,
  };
}

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
  const y = muzzleHeight(spec);
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

/** True if the target's hull would be hit by a broadside on `side` fired now: its centre lies in the landing zone. */
export function targetInZone(
  zone: AimZone,
  shooter: Pick<Hull, 'x' | 'z' | 'heading'>,
  side: Side,
  target: Pick<Hull, 'x' | 'z'>,
  targetLength: number,
): boolean {
  const dx = target.x - shooter.x;
  const dz = target.z - shooter.z;
  const c = Math.cos(shooter.heading);
  const s = Math.sin(shooter.heading);
  const along = dx * c - dz * s;
  const across = (dx * s + dz * c) * (side === 'starboard' ? 1 : -1);
  const slack = targetLength / 2 + zone.spread;
  return across > zone.near - slack * 0.5 && across < zone.far + slack * 0.5 && Math.abs(along - zone.drift) < zone.halfSpan + slack;
}
