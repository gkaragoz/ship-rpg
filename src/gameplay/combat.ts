import type { GameEvent, Owner } from '../core';
import { CONFIG, lerp } from '../core';
import type { HitZone } from '../core';
import { WATERLINE_BAND } from './damage';
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
  /** Times it has skipped off the sea (see `ricochet`). */
  skips?: number;
}

/** What a ship needs to fire or be hit: position, heading, speed. */
export interface Hull {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

/** Tuning constants. Plain numbers (not `as const`) so `scripts/sweep.ts` can try values; the game never changes them. */
export const COMBAT: Record<'ballSpeed' | 'gravity' | 'drag' | 'yawJitter' | 'elevationMin' | 'elevationMax' | 'maxPerVolley' | 'damagePerLb' | 'playerReload' | 'enemyReload' | 'enemySpread' | 'maxAge', number> = {
  /** Muzzle speed, m/s. With the elevation range below and the drag, shots land about 115–150 m out. */
  ballSpeed: 92,
  gravity: 9.81,
  /** Quadratic air drag: deceleration is `drag × speed²` (1/m), relative to the air, so a wind pushes the ball. */
  drag: 0.00035,
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

/** A flight over still air: the height (m) at each metre travelled out, and the time (s) it lands. */
interface Trajectory {
  heights: number[];
  landsAt: number;
}

const trajectories = new Map<string, Trajectory>();

/** Fly a ball fired at `elev` from `y0` with the same step the game uses, and tabulate it (cached per muzzle height and elevation). */
function trajectoryOf(y0: number, elev: number): Trajectory {
  const key = `${y0}|${elev}|${COMBAT.ballSpeed}|${COMBAT.drag}`;
  const known = trajectories.get(key);
  if (known) return known;
  const b: Ball = { id: 0, owner: 'player', x: 0, y: y0, z: 0, vx: COMBAT.ballSpeed * Math.cos(elev), vy: COMBAT.ballSpeed * Math.sin(elev), vz: 0, damage: 0, age: 0 };
  const heights = [y0];
  const dt = 1 / 120;
  while (b.y > -1 && b.age < COMBAT.maxAge) {
    stepBall(b, dt);
    const index = Math.floor(b.x);
    for (let i = heights.length; i <= index; i++) heights.push(b.y);
  }
  const t: Trajectory = { heights, landsAt: b.age };
  trajectories.set(key, t);
  return t;
}

/** Height (m) of a ball fired at `elev` after it has travelled `d` metres horizontally (beyond the landing it is under water). */
const ballHeight = (spec: ShipSpec, elev: number, d: number): number => {
  const h = trajectoryOf(muzzleHeight(spec), elev).heights;
  const i = Math.floor(d);
  if (i >= h.length - 1) return -1;
  const f = d - i;
  return (h[i] ?? -1) * (1 - f) + (h[i + 1] ?? -1) * f;
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
const flightTime = (elev: number, y: number): number => trajectoryOf(y, elev).landsAt;

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
    if (i % Math.max(1, Math.floor(n / 4)) === 0) events.push({ type: 'fire', owner, x: px, y, z: pz, nx: dirX, nz: dirZ });
  }
  return { balls, events };
}

/** The air's velocity (m/s, x and z) for a wind blowing from `from` at `speed`: it blows towards the opposite direction. */
export const windVelocity = (wind: { from: number; speed: number }): { x: number; z: number } => ({
  x: Math.cos(wind.from + Math.PI) * wind.speed,
  z: -Math.sin(wind.from + Math.PI) * wind.speed,
});

/** One step of flight: gravity and quadratic drag against the air (still unless `air` is given). */
export function stepBall(b: Ball, dt: number, air?: { x: number; z: number }): void {
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  const rx = b.vx - (air?.x ?? 0);
  const rz = b.vz - (air?.z ?? 0);
  const k = COMBAT.drag * Math.hypot(rx, b.vy, rz) * dt;
  b.vx -= rx * k;
  b.vz -= rz * k;
  b.vy -= b.vy * k + COMBAT.gravity * dt;
  b.age += dt;
}

/** The ball's speed (m/s). */
export const ballSpeed = (b: Ball): number => Math.hypot(b.vx, b.vy, b.vz);

/** Balls that strike the sea at a shallower angle than this (rad) and faster than `RICOCHET_SPEED` skip off it. */
const RICOCHET_ANGLE = 0.14;
const RICOCHET_SPEED = 55;
const MAX_SKIPS = 2;

/**
 * A ball that has gone under the surface at a glancing angle skips: it bounces up with less speed and a little damage
 * less. Returns true if it skipped (the caller reports a splash and keeps the ball), false if it sinks.
 */
export function ricochet(b: Ball, surface: number): boolean {
  const speed = ballSpeed(b);
  if ((b.skips ?? 0) >= MAX_SKIPS || speed < RICOCHET_SPEED || b.vy >= 0) return false;
  if (-b.vy / speed > Math.sin(RICOCHET_ANGLE)) return false;
  b.skips = (b.skips ?? 0) + 1;
  b.y = surface + 0.05;
  b.vy = -b.vy * 0.55;
  b.vx *= 0.7;
  b.vz *= 0.7;
  b.damage *= 0.6;
  return true;
}

/** Unit normal (x, z) of the hull side a ball struck: outwards from the keel line on the side it came from. */
export function hitNormal(b: Ball, target: Pick<Hull, 'x' | 'z' | 'heading'>): { x: number; z: number } {
  const c = Math.cos(target.heading);
  const s = Math.sin(target.heading);
  const across = (b.x - target.x) * s + (b.z - target.z) * c;
  const side = across >= 0 ? 1 : -1;
  return { x: s * side, z: c * side };
}

/**
 * Where a ball strikes a ship, or null if it misses: inside the hull footprint, between the keel and
 * the height of the hull plus rigging, and by height: just above the sea is the waterline, up to the
 * deck rail the hull, above that the rigging.
 */
export function ballHitZone(b: Ball, target: Pick<Hull, 'x' | 'z' | 'heading'>, spec: ShipSpec): HitZone | null {
  const dx = b.x - target.x;
  const dz = b.z - target.z;
  const c = Math.cos(target.heading);
  const s = Math.sin(target.heading);
  const along = dx * c - dz * s;
  const across = dx * s + dz * c;
  if (Math.abs(along) >= spec.length / 2 || Math.abs(across) >= spec.beam / 2) return null;
  if (b.y <= -spec.draft || b.y >= spec.freeboard + 1.5) return null;
  if (b.y < WATERLINE_BAND) return 'waterline';
  return b.y < spec.freeboard ? 'hull' : 'rigging';
}

/** True if the ball is inside the target's hull footprint, between keel and rail (plus rigging height). */
export const ballHits = (b: Ball, target: Pick<Hull, 'x' | 'z' | 'heading'>, spec: ShipSpec): boolean =>
  ballHitZone(b, target, spec) !== null;

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
