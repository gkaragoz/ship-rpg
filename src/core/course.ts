import { clamp, angleDiff, wrapAngle } from './math';

/** Where a ship was and which way its bow pointed the last time `followCourse` saw it. */
export interface Track {
  x: number;
  z: number;
  heading: number;
}

/** Tuning of `followCourse`. */
export const COURSE = {
  /** Slowest the bow may swing to follow the way the ship really moves (rad/s): a hull cannot spin on the spot. */
  turnRate: 0.7,
  /** Slower than this (m/s) the way the ship moves says nothing, so the bow keeps its intended heading. */
  minSpeed: 0.6,
  /** A move farther than this (m) in one step is a teleport (a load, a respawn), not a motion. */
  jump: 80,
  /** A way of moving further than this (rad) from the intended heading is a shove astern, not a course. */
  astern: 1.9,
} as const;

/**
 * The bow of a ship that is moved along a path rather than sailed: it follows the way the ship actually goes, at a
 * limited turn rate, so a ship that is shoved aside, steered round another or turned at a waypoint never slides
 * crabwise or spins on the spot. Stopped, it takes the heading it was meant to have. Pure: returns the new track.
 */
export function followCourse(prev: Track | undefined, x: number, z: number, intended: number, dt: number): Track {
  if (!prev || dt <= 0 || Math.hypot(x - prev.x, z - prev.z) > COURSE.jump) return { x, z, heading: intended };
  const dx = x - prev.x;
  const dz = z - prev.z;
  const moving = Math.hypot(dx, dz) / dt > COURSE.minSpeed;
  const course = Math.atan2(-dz, dx);
  // pushed astern (more than a right angle off the bow): the bow stays on its heading instead of spinning round to face the way it is shoved
  const target = moving && Math.abs(angleDiff(course, intended)) < COURSE.astern ? course : intended;
  const step = clamp(angleDiff(target, prev.heading), -COURSE.turnRate * dt, COURSE.turnRate * dt);
  return { x, z, heading: wrapAngle(prev.heading + step) };
}
