import { angleDiff, clamp, wrapAngle } from '../core';
import type { Controls, WindView } from '../core';
import type { ShipSpec } from '../ships';
import { NOMINAL_WIND, apparentWind, sailEfficiency, terrainHeight } from '../world';
import { NO_SEA_EFFECTS, createBody, type Body, type SeaEffects } from './buoyancy';
import { floodSpeedFactor, repairRigging, riggingSpeedFactor, riggingTurnFactor } from './damage';

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
  /** Heel (rad) of a ship under full sail in a wind of `NOMINAL_WIND`, abeam. */
  heel: 0.14,
  /** Leeway: the angle (rad) between where the keel points and where the ship goes, at that heel (it grows and shrinks with it). */
  leeway: 0.07,
  /** Time constant (s) in which the water damps the swing a crash gave the bow. */
  spinDecay: 0.7,
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
  /** Health of sails and rigging, 1 intact … 0 wrecked: slows the ship and blunts its turning (see `damage.ts`). */
  rigging: number;
  /** Water in the hull, 0 dry … 1 swamped, and fire aboard, 0 … 1: they cost hull points and, flooded, speed (see `damage.ts`). */
  flooding: number;
  fire: number;
  /** Yaw rate (rad/s) a crash gave the bow; the water damps it out within `SAILING.spinDecay` seconds (see `collision.ts`). */
  spin: number;
  /** Heave, pitch and wave roll: the hull riding the sea (see `buoyancy.ts`). */
  body: Body;
}

export function createPlayerShip(x = 0, z = 0, heading = 0): PlayerShip {
  return { x, z, heading, speed: 0, rudder: 0, sailTarget: 0.5, sailLevel: 0.5, efficiency: 0, roll: 0, grounded: 0, docked: false, rigging: 1, flooding: 0, fire: 0, spin: 0, body: createBody() };
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
export function stepPlayerShip(s: PlayerShip, spec: ShipSpec, wind: WindView, controls: Controls, dt: number, sea: SeaEffects = NO_SEA_EFFECTS): void {
  if (controls.sailStep !== 0) s.sailTarget = clamp(s.sailTarget + controls.sailStep * 0.5, 0, 1);
  s.sailLevel += clamp(s.sailTarget - s.sailLevel, -SAILING.sailRate * dt, SAILING.sailRate * dt);
  if (s.docked) {
    // Moored: stay put and let the sails come down; the hull settles upright.
    s.speed = 0;
    s.rudder = 0;
    s.sailTarget = 0;
    s.grounded = 0;
    s.spin = 0;
    s.rigging = repairRigging(s.rigging, true, dt);
    s.roll += (0 - s.roll) * Math.min(1, dt * 2);
    return;
  }
  s.rudder += clamp(controls.rudder - s.rudder, -SAILING.rudderRate * dt, SAILING.rudderRate * dt);
  s.grounded = Math.max(0, s.grounded - dt);
  s.rigging = repairRigging(s.rigging, false, dt);

  // > 0: the wind comes from the port side; < 0: from starboard.
  const rel = angleDiff(wind.from, s.heading);
  s.efficiency = sailEfficiency(Math.abs(rel));

  const top = maxSpeed(spec);
  const windFactor = clamp(wind.speed / NOMINAL_WIND, 0.3, 1.5);
  // Aground, the sails are no use until the ship has drifted clear.
  const drive = s.grounded > 0 ? 0 : s.sailLevel * s.efficiency;
  // Head to wind the sails only push the ship astern, slowly: that is what lets it fall off again.
  const sternway = s.grounded <= 0 && s.efficiency < 0.05 ? -top * SAILING.ironsDrift * s.sailLevel : 0;
  // Wrecked sails drive the ship less; the drift astern in irons is the wind's doing, not the sails'.
  const target = Math.min(top * drive * windFactor, top * SAILING.overspeed) * riggingSpeedFactor(s.rigging) * floodSpeedFactor(s.flooding) * sea.speed + sternway;
  const rate = target > s.speed ? SAILING.accel : SAILING.drag;
  s.speed += (target - s.speed) * (1 - Math.exp(-rate * dt));

  // A rudder only bites while water flows past it.
  const sailed = s.sailLevel > 0.05 ? SAILING.minAuthority : 0;
  const authority = Math.max(clamp(Math.abs(s.speed) / (0.4 * top), 0, 1), sailed, s.grounded > 0 ? 0.5 : 0);
  const previousHeading = s.heading;
  // A crash swings the bow over a fraction of a second (the rudder's turn and the swing add), then the water damps it out.
  s.heading = wrapAngle(s.heading - s.rudder * spec.stats.turn * SAILING.turnScale * authority * riggingTurnFactor(s.rigging) * sea.turn * dt + s.spin * dt);
  s.spin *= Math.exp(-dt / SAILING.spinDecay);
  if (Math.abs(s.spin) < 1e-4) s.spin = 0;
  // The hull cannot swing a corner onto the bottom; this also keeps a grounded ship from pinning itself.
  if (isBlocked(s, spec)) s.heading = previousHeading;
  s.speed *= 1 - 0.05 * Math.abs(s.rudder) * dt;
  s.flooding = Math.min(1, s.flooding + sea.shipping * dt); // green water over the bow

  // The wind the ship feels (its own motion included) heels it and pushes it sideways: leeway, away from the wind.
  const felt = apparentWind(wind, s.heading, s.speed);
  const feltRel = angleDiff(felt.from, s.heading);
  const feltFactor = clamp(felt.speed / NOMINAL_WIND, 0.3, 1.5);
  const heel = Math.sign(feltRel) * SAILING.heel * s.sailLevel * Math.sin(Math.abs(feltRel)) * feltFactor;
  const sideSpeed = s.grounded > 0 ? 0 : Math.tan(SAILING.leeway * (heel / SAILING.heel)) * Math.abs(s.speed) * sea.lee;

  const px = s.x;
  const pz = s.z;
  s.x += (Math.cos(s.heading) * s.speed + Math.sin(s.heading) * sideSpeed) * dt;
  s.z += (-Math.sin(s.heading) * s.speed + Math.cos(s.heading) * sideSpeed) * dt;
  if (isBlocked(s, spec)) {
    // Touched the bottom: undo the move and drift back out stern-first.
    s.x = px;
    s.z = pz;
    s.speed = -SAILING.bounceSpeed;
    s.grounded = SAILING.groundedTime;
  }

  // Heel away from the wind under sail (computed above from the apparent wind), and lean out of a turn.
  const lean = -s.rudder * 0.06 * authority;
  s.roll += (heel + lean - s.roll) * Math.min(1, dt * 2);
}
