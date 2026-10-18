import type { GameEvent, Owner } from '../core';
import { lerp } from '../core';
import type { ShipSpec } from '../ships';
import { COMBAT, bandOf, cannonsPerSide, muzzleHeight, stepBall, type Ball, type Hull, type Side } from './combat';

/**
 * Firing the guns: what one gun does (`fireGun`), how a broadside is drawn up (`planBroadside`, optionally rippling along the
 * hull), the simple all-at-once broadside of the duel simulator (`fireBroadside`) and the flight path shown to the player (`arcFor`).
 */

/** Everything about one gun's shot that is drawn at random: sideways yaw and elevation (rad), and the delay (s) before it fires. */
export interface GunShot {
  yaw: number;
  elev: number;
  delay: number;
}

/** Build the ball and the muzzle blast of gun `index` of `n` on `side` of `hull`, from the hull as it is now. Forward is (cos ψ, -sin ψ), starboard (sin ψ, cos ψ). */
export function fireGun(owner: Owner, hull: Hull, spec: ShipSpec, side: Side, index: number, n: number, shot: GunShot, nextId: () => number): { ball: Ball; event: GameEvent } {
  const c = Math.cos(hull.heading);
  const s = Math.sin(hull.heading);
  const sign = side === 'starboard' ? 1 : -1;
  const dirX = s * sign;
  const dirZ = c * sign;
  const y = muzzleHeight(spec);
  // Keep a big ship's firepower when its guns exceed the ball cap: heavier hits, same total.
  const damage = spec.stats.shot * COMBAT.damagePerLb * (spec.stats.cannons / 2 / n);
  const along = (-0.3 + (0.6 * (index + 0.5)) / n) * spec.length;
  const px = hull.x + c * along + dirX * (spec.beam / 2);
  const pz = hull.z - s * along + dirZ * (spec.beam / 2);
  const cy = Math.cos(shot.yaw);
  const sy = Math.sin(shot.yaw);
  const horizontal = COMBAT.ballSpeed * Math.cos(shot.elev);
  const ball: Ball = {
    id: nextId(),
    owner,
    x: px,
    y,
    z: pz,
    vx: (dirX * cy - dirZ * sy) * horizontal + c * hull.speed,
    vy: COMBAT.ballSpeed * Math.sin(shot.elev),
    vz: (dirX * sy + dirZ * cy) * horizontal - s * hull.speed,
    damage,
    age: 0,
  };
  return { ball, event: { type: 'fire', owner, x: px, y, z: pz, nx: dirX, nz: dirZ } };
}

/**
 * Draw the random parts of a broadside: per gun a yaw and an elevation (`elevation` ± `ELEVATION_SPREAD` when aimed, else the
 * default band), in that order (the duel relies on the sequence). With `ripple` each gun also gets a delay: the guns go off in
 * a rolling sequence along the hull (fore to aft or aft to fore), each a little early or late, over about half a second.
 */
export function planBroadside(spec: ShipSpec, rng: () => number, spread: number, elevation?: number, ripple = false): GunShot[] {
  const n = cannonsPerSide(spec);
  const [lo, hi] = bandOf(elevation);
  const shots: GunShot[] = [];
  for (let i = 0; i < n; i++) {
    const yaw = (rng() * 2 - 1) * COMBAT.yawJitter * spread;
    const elev = lerp(lo, hi, rng());
    shots.push({ yaw, elev, delay: 0 });
  }
  if (ripple && n > 0) {
    const span = Math.min(0.75, 0.3 + 0.02 * n);
    const foreToAft = rng() < 0.5;
    shots.forEach((shot, i) => {
      const order = foreToAft ? n - 1 - i : i;
      shot.delay = Math.max(0, (n === 1 ? 0 : (order / (n - 1)) * span) + (rng() - 0.5) * 0.16 + rng() * 0.05);
    });
  }
  return shots;
}

/**
 * Fire one broadside at once (the duel simulator's way: no ripple, one muzzle blast per quarter of the guns).
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
  const plan = planBroadside(spec, rng, spread);
  plan.forEach((shot, i) => {
    const gun = fireGun(owner, hull, spec, side, i, n, shot, nextId);
    balls.push(gun.ball);
    if (i % Math.max(1, Math.floor(n / 4)) === 0) events.push(gun.event);
  });
  return { balls, events };
}

/** A point of a flight path in the world (metres). */
export interface ArcPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * The path a ball fired from the middle of the `side` broadside at `elevation` will fly, with drag, the wind and the ship's
 * own speed, as `points` evenly spaced steps from the muzzle to the sea (the last point is where it lands).
 */
export function arcFor(spec: ShipSpec, hull: Hull, side: Side, elevation: number, air: { x: number; z: number }, points = 36): ArcPoint[] {
  const shot: GunShot = { yaw: 0, elev: elevation, delay: 0 };
  const n = Math.max(1, cannonsPerSide(spec));
  const { ball } = fireGun('player', hull, spec, side, Math.floor((n - 1) / 2), n, shot, () => 0);
  const start: ArcPoint = { x: ball.x, y: ball.y, z: ball.z };
  const dt = 1 / 60;
  // Fly it once to count the steps to the landing, then again to pick the evenly spaced points (no per-step allocations).
  const flown = (): number => {
    let steps = 0;
    while (ball.y > 0 && ball.age < COMBAT.maxAge) {
      stepBall(ball, dt, air);
      steps++;
    }
    return steps;
  };
  const total = Math.max(1, flown());
  const again = fireGun('player', hull, spec, side, Math.floor((n - 1) / 2), n, shot, () => 0).ball;
  const path: ArcPoint[] = [start];
  let step = 0;
  for (let i = 1; i <= points; i++) {
    const until = Math.round((i / points) * total);
    while (step < until) {
      stepBall(again, dt, air);
      step++;
    }
    path.push({ x: again.x, y: Math.max(again.y, 0), z: again.z });
  }
  return path;
}

