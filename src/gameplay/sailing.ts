import { angleDiff, clamp, wrapAngle } from '../core';
import type { Controls, WindView } from '../core';
import type { ShipSpec } from '../ships';
import { NOMINAL_WIND, sailEfficiency } from '../world';

/** Tuning: converts the original game's stats into metres and seconds. */
export const SAILING = {
  /** m/s per unit of the `speed` stat. */
  speedScale: 0.7,
  /** rad/s of rudder-limited turning per unit of the `turn` stat. */
  turnScale: 0.012,
  /** Speed may overshoot the listed value by this factor in a strong wind. */
  overspeed: 1.15,
  /** Seconds-based easing rates. */
  sailRate: 0.5,
  rudderRate: 2,
  accel: 0.35,
  drag: 0.15,
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
}

export function createPlayerShip(x = 0, z = 0, heading = 0): PlayerShip {
  return { x, z, heading, speed: 0, rudder: 0, sailTarget: 0.5, sailLevel: 0.5, efficiency: 0, roll: 0 };
}

export const maxSpeed = (spec: ShipSpec): number => spec.stats.speed * SAILING.speedScale;

/** Advance the player's ship by one fixed step. */
export function stepPlayerShip(s: PlayerShip, spec: ShipSpec, wind: WindView, controls: Controls, dt: number): void {
  if (controls.sailStep !== 0) s.sailTarget = clamp(s.sailTarget + controls.sailStep * 0.5, 0, 1);
  s.sailLevel += clamp(s.sailTarget - s.sailLevel, -SAILING.sailRate * dt, SAILING.sailRate * dt);
  s.rudder += clamp(controls.rudder - s.rudder, -SAILING.rudderRate * dt, SAILING.rudderRate * dt);

  // > 0: the wind comes from the port side; < 0: from starboard.
  const rel = angleDiff(wind.from, s.heading);
  s.efficiency = sailEfficiency(Math.abs(rel));

  const top = maxSpeed(spec);
  const windFactor = clamp(wind.speed / NOMINAL_WIND, 0.3, 1.5);
  const target = Math.min(top * s.sailLevel * s.efficiency * windFactor, top * SAILING.overspeed);
  const rate = target > s.speed ? SAILING.accel : SAILING.drag;
  s.speed += (target - s.speed) * (1 - Math.exp(-rate * dt));

  // A rudder only bites while water flows past it.
  const authority = clamp(s.speed / (0.4 * top), 0, 1);
  s.heading = wrapAngle(s.heading - s.rudder * spec.stats.turn * SAILING.turnScale * authority * dt);
  s.speed *= 1 - 0.05 * Math.abs(s.rudder) * dt;

  s.x += Math.cos(s.heading) * s.speed * dt;
  s.z -= Math.sin(s.heading) * s.speed * dt;

  // Heel away from the wind under sail, and lean out of a turn.
  const heel = Math.sign(rel) * 0.14 * s.sailLevel * Math.sin(Math.abs(rel)) * windFactor;
  const lean = -s.rudder * 0.06 * authority;
  s.roll += (heel + lean - s.roll) * Math.min(1, dt * 2);
}
