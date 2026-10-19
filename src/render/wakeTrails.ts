import { angleDiff, wrapAngle } from '../core';

/** What `WakeTrails.step` learned about a ship this frame. */
export interface TrailStep {
  /** Direction the ship really travels (a heading), leeway and shoves included; its bow's heading while it is hardly moving. */
  course: number;
  /** Where it was the frame before (equal to the new position the first time it is seen), and its speed over the ground (m/s). */
  px: number;
  pz: number;
  speed: number;
}

/**
 * Remembers where each ship was, so the foam it lays can follow the way the ship actually goes (not the way its bow
 * points) and can fill the gap between two frames when it moves far in one.
 */
export interface WakeTrails {
  step(key: string, x: number, z: number, heading: number, dt: number): TrailStep;
  /** Call once a frame, after every ship has been stepped: forgets the ships that were not seen. */
  sweep(): void;
}

interface Track {
  x: number;
  z: number;
  course: number;
  seen: number;
}

/** Slower than this (m/s) over the ground a ship has no course of its own. */
const MIN_SPEED = 0.6;
/** A move longer than this (m) in a frame is a jump (a load, a respawn), not a motion. */
const JUMP = 120;
/** Time constant (s) of the smoothing of the course, which jitters a little with the frame time. */
const SMOOTHING = 0.12;

export function createWakeTrails(): WakeTrails {
  const tracks = new Map<string, Track>();
  let frame = 0;
  return {
    step(key, x, z, heading, dt): TrailStep {
      const t = tracks.get(key);
      if (!t || dt <= 0 || Math.hypot(x - t.x, z - t.z) > JUMP) {
        tracks.set(key, { x, z, course: heading, seen: frame });
        return { course: heading, px: x, pz: z, speed: 0 };
      }
      const dx = x - t.x;
      const dz = z - t.z;
      const speed = Math.hypot(dx, dz) / dt;
      const px = t.x;
      const pz = t.z;
      // a ship that goes astern (a recoil, a rebound) still has its bow ahead: take the course on the bow's side
      const raw = speed > MIN_SPEED ? Math.atan2(-dz, dx) : heading;
      const along = Math.abs(angleDiff(raw, heading)) > Math.PI / 2 ? wrapAngle(raw + Math.PI) : raw;
      const follow = 1 - Math.exp(-dt / SMOOTHING);
      t.course = wrapAngle(t.course + angleDiff(along, t.course) * follow);
      t.x = x;
      t.z = z;
      t.seen = frame;
      return { course: t.course, px, pz, speed };
    },
    sweep(): void {
      for (const [key, t] of tracks) if (t.seen !== frame) tracks.delete(key);
      frame++;
    },
  };
}
