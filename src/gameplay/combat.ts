import type { GameEvent, Owner } from '../core';
import { CONFIG, lerp } from '../core';
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

/** Tuning constants. Plain numbers (not `as const`) so `scripts/sweep.ts` can try values; the game never changes them. */
export const COMBAT: Record<'ballSpeed' | 'gravity' | 'yawJitter' | 'elevationMin' | 'elevationMax' | 'maxPerVolley' | 'damagePerLb' | 'playerReload' | 'enemyReload' | 'enemySpread' | 'maxAge', number> = {
  /** Muzzle speed, m/s. With the elevation range below shots land about 115–150 m out. */
  ballSpeed: 90,
  gravity: 9.81,
  /** Random sideways spread and elevation range, radians. */
  yawJitter: 0.035,
  elevationMin: 0.07,
  elevationMax: 0.09,
  /** At most this many balls per broadside; guns beyond it add damage to the balls instead. */
  maxPerVolley: 24,
  /** Hit points per pound of shot. */
  damagePerLb: 2.5,
  /** Seconds to reload a broadside. */
  playerReload: 6,
  enemyReload: 8,
  /** The enemy's sideways spread is this many times the player's: part of the enemy handicap (see docs/BALANCE.md). */
  enemySpread: 1.3,
  /** Balls older than this are dropped. */
  maxAge: 6,
};

/** Muzzle height above the sea. */
export const muzzleHeight = (spec: ShipSpec): number => Math.max(1.2, spec.freeboard - 0.8);

export interface AimZone {
  /** Distance from the centreline to the muzzles (half the beam). */
  side: number;
  /** Distances from the ship's centreline (m) between which a ball can hit a ship abeam. */
  near: number;
  far: number;
  /** Chance 0…1 that a ball hits, at `CONFIG.aimSteps + 1` distances spread evenly from `near` to `far`. */
  profile: number[];
  /** Half the length (m) along the hull over which the guns are spread. */
  halfSpan: number;
  /** How far forward (m) the ship's own speed carries the zone. */
  drift: number;
  /** Extra sideways scatter (m) at the far edge. */
  spread: number;
}

/** Height (m) of a ball fired at `elev` after it has travelled `d` metres horizontally. */
const ballHeight = (spec: ShipSpec, elev: number, d: number): number => {
  const cos = Math.cos(elev);
  return muzzleHeight(spec) + Math.tan(elev) * d - (COMBAT.gravity * d * d) / (2 * (COMBAT.ballSpeed * cos) ** 2);
};

/** Elevations tried when working out the chance of a hit: an even spread over the firing range. */
const ELEVATION_SAMPLES = 24;

/**
 * Chance 0…1 that a ball of a broadside hits a ship of the same size `d` metres away abeam: the
 * share of the elevation range for which the ball is airborne and below the target's hull-and-
 * rigging height there (the same height test `ballHits` uses). A ball flies low and flat over the
 * first stretch, climbs, then falls, so the hittable stretch is not just where balls land.
 */
export function hitChanceAt(spec: ShipSpec, d: number): number {
  const top = spec.freeboard + 1.5;
  let hits = 0;
  for (let i = 0; i < ELEVATION_SAMPLES; i++) {
    const elev = COMBAT.elevationMin + ((COMBAT.elevationMax - COMBAT.elevationMin) * i) / (ELEVATION_SAMPLES - 1);
    const y = ballHeight(spec, elev, d);
    if (y > 0 && y < top) hits++;
  }
  return hits / ELEVATION_SAMPLES;
}

/** Seconds a ball fired at `elev` takes to come down to the sea from the muzzle. */
const flightTime = (elev: number, y: number): number => {
  const vy = COMBAT.ballSpeed * Math.sin(elev);
  return (vy + Math.sqrt(vy * vy + 2 * COMBAT.gravity * y)) / COMBAT.gravity;
};

/**
 * Where a broadside can hit, from the same ballistics `fireBroadside` uses (see tests): the stretch
 * abeam where the chance of a hit is above zero, and that chance across it. Short of the far edge
 * the chance is high but not constant: high-angle shots pass over a target at middle distances.
 */
export function aimZone(spec: ShipSpec, shipSpeed: number): AimZone {
  const STEP = 2;
  const MAX = 400;
  let first = -1;
  let last = 0;
  for (let d = 0; d <= MAX; d += STEP) {
    if (hitChanceAt(spec, d) > 0) {
      if (first < 0) first = d;
      last = d;
    }
  }
  const nearD = Math.max(first, 0);
  const farD = Math.max(last, nearD + STEP);
  const steps = CONFIG.aimSteps;
  const profile = Array.from({ length: steps + 1 }, (_, i) => hitChanceAt(spec, nearD + ((farD - nearD) * i) / steps));
  const y = muzzleHeight(spec);
  const meanFlight = (flightTime(COMBAT.elevationMin, y) + flightTime(COMBAT.elevationMax, y)) / 2;
  return {
    side: spec.beam / 2,
    near: spec.beam / 2 + nearD,
    far: spec.beam / 2 + farD,
    profile,
    halfSpan: 0.3 * spec.length,
    drift: shipSpeed * meanFlight,
    spread: Math.tan(COMBAT.yawJitter) * farD,
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
  /** Sideways spread as a multiple of `COMBAT.yawJitter`; by default 1 for the player and `COMBAT.enemySpread` for enemies. */
  spread: number = owner === 'enemy' ? COMBAT.enemySpread : 1,
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
    const yaw = (rng() * 2 - 1) * COMBAT.yawJitter * spread;
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
