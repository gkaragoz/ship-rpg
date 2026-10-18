import { angleDiff, clamp, wrapAngle } from '../core';
import type { Controls, WindView } from '../core';
import type { ShipSpec } from '../ships';
import { NOMINAL_WIND, sailEfficiency, terrainHeight } from '../world';

/** Tuning: converts the original game's stats into metres and seconds. */
export const SAILING = {
  /** m/s per unit of the `speed` stat. */
  speedScale: 0.7,
  /** rad/s of rudder-limited turning per unit of the `turn` stat. */
  turnScale: 0.006,
  /** Speed may overshoot the listed value by this factor in a strong wind. */
  overspeed: 1.15,
  /** Seconds-based easing rates. */
  sailRate: 0.5,
  rudderRate: 2,
  accel: 0.35,
  drag: 0.15,
  /** After touching the bottom the ship drifts back at this speed (m/s) for this long (s). */
  bounceSpeed: 1.5,
  groundedTime: 1.5,
  /** Extra water (m) the keel needs under it. */
  keelMargin: 0.5,
  /** With sails set the ship can always bear off, even stopped in irons: this much rudder authority. */
  minAuthority: 0.35,
  /** Sternway in irons, as a fraction of top speed at full sail. */
  ironsDrift: 0.08,
} as const;

export interface PlayerShip {
  x: number;
  z: number;
  heading: number;
  speed: number;
  rudder: number;
  sailTarget: number;
  sailLevel: number;
  efficiency: number;
  roll: number;
  /** Seconds left of the grounded recovery; 0 when afloat. */
  grounded: number;
  /** Moored at a port: the ship does not move. */
  docked: boolean;
}

export function createPlayerShip(x = 0, z = 0, heading = 0): PlayerShip {
  return { x, z, heading, speed: 0, rudder: 0, sailTarget: 0.5, sailLevel: 0.5, efficiency: 0, roll: 0, grounded: 0, docked: false };
}

export const maxSpeed = (spec: ShipSpec): number => spec.stats.speed * SAILING.speedScale;

/** True if any point of the hull (bow, stern, amidships and both sides) is over water too shallow for the keel. */
export function isBlocked(s: Pick<PlayerShip, 'x' | 'z' | 'heading'>, spec: ShipSpec): boolean {
  const c = Math.cos(s.heading);
  const sn = Math.sin(s.heading);
  const hl = spec.length * 0.45;
  const hb = spec.beam * 0.4;
  const limit = -(spec.draft + SAILING.keelMargin);
  // Forward is (c, -sn); starboard is (sn, c).
  const points: [number, number][] = [
    [hl, 0], [-hl, 0], [0, 0], [0, hb], [0, -hb],
  ];
  return points.some(([f, r]) => terrainHeight(s.x + c * f + sn * r, s.z - sn * f + c * r) > limit);
}

/** Advance the player's ship by one fixed step. */
export function stepPlayerShip(s: PlayerShip, spec: ShipSpec, wind: WindView, controls: Controls, dt: number): void {
  if (controls.sailStep !== 0) s.sailTarget = clamp(s.sailTarget + controls.sailStep * 0.5, 0, 1);
  s.sailLevel += clamp(s.sailTarget - s.sailLevel, -SAILING.sailRate * dt, SAILING.sailRate * dt);
  if (s.docked) {
    // Moored: stay put and let the sails come down; the hull settles upright.
    s.speed = 0;
    s.rudder = 0;
    s.sailTarget = 0;
    s.grounded = 0;
    s.roll += (0 - s.roll) * Math.min(1, dt * 2);
    return;
  }
  s.rudder += clamp(controls.rudder - s.rudder, -SAILING.rudderRate * dt, SAILING.rudderRate * dt);
  s.grounded = Math.max(0, s.grounded - dt);

  // > 0: the wind comes from the port side; < 0: from starboard.
  const rel = angleDiff(wind.from, s.heading);
  s.efficiency = sailEfficiency(Math.abs(rel));

  const top = maxSpeed(spec);
  const windFactor = clamp(wind.speed / NOMINAL_WIND, 0.3, 1.5);
  // Aground, the sails are no use until the ship has drifted clear.
  const drive = s.grounded > 0 ? 0 : s.sailLevel * s.efficiency;
  // Head to wind the sails only push the ship astern, slowly: that is what lets it fall off again.
  const sternway = s.grounded <= 0 && s.efficiency < 0.05 ? -top * SAILING.ironsDrift * s.sailLevel : 0;
  const target = Math.min(top * drive * windFactor, top * SAILING.overspeed) + sternway;
  const rate = target > s.speed ? SAILING.accel : SAILING.drag;
  s.speed += (target - s.speed) * (1 - Math.exp(-rate * dt));

  // A rudder only bites while water flows past it.
  const sailed = s.sailLevel > 0.05 ? SAILING.minAuthority : 0;
  const authority = Math.max(clamp(Math.abs(s.speed) / (0.4 * top), 0, 1), sailed, s.grounded > 0 ? 0.5 : 0);
  const previousHeading = s.heading;
  s.heading = wrapAngle(s.heading - s.rudder * spec.stats.turn * SAILING.turnScale * authority * dt);
  // The hull cannot swing a corner onto the bottom; this also keeps a grounded ship from pinning itself.
  if (isBlocked(s, spec)) s.heading = previousHeading;
  s.speed *= 1 - 0.05 * Math.abs(s.rudder) * dt;

  const px = s.x;
  const pz = s.z;
  s.x += Math.cos(s.heading) * s.speed * dt;
  s.z -= Math.sin(s.heading) * s.speed * dt;
  if (isBlocked(s, spec)) {
    // Touched the bottom: undo the move and drift back out stern-first.
    s.x = px;
    s.z = pz;
    s.speed = -SAILING.bounceSpeed;
    s.grounded = SAILING.groundedTime;
  }

  // Heel away from the wind under sail, and lean out of a turn.
  const heel = Math.sign(rel) * 0.14 * s.sailLevel * Math.sin(Math.abs(rel)) * windFactor;
  const lean = -s.rudder * 0.06 * authority;
  s.roll += (heel + lean - s.roll) * Math.min(1, dt * 2);
}
