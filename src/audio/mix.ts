import { clamp } from '../core';

export interface Listener {
  x: number;
  z: number;
  /** Heading in the world convention of `core/views.ts`: forward is (cos ψ, -sin ψ). */
  heading: number;
}

export interface Mix {
  /** 0…1 loudness. */
  gain: number;
  /** -1 (port) … +1 (starboard). */
  pan: number;
  /** Seconds before the sound arrives. */
  delay: number;
}

/** Distance (m) at which a sound is at half loudness. */
export const REFERENCE_DISTANCE = 120;
/** Speed of sound in m/s: a broadside 340 m away is heard a second after it is seen. */
export const SPEED_OF_SOUND = 340;
/** Sounds quieter than this are skipped. */
export const AUDIBLE = 0.02;
const MAX_DELAY = 2.5;

/**
 * Where and how loud a sound at (x, z) is for `listener`: gain falls with distance, pan
 * follows the bearing (starboard is +), delay is the travel time of sound.
 */
export function spatialMix(listener: Listener, x: number, z: number, loudness = 1): Mix {
  const dx = x - listener.x;
  const dz = z - listener.z;
  const dist = Math.hypot(dx, dz);
  // Starboard is (sin ψ, cos ψ) in (x, z): its share of the direction to the source.
  const pan = dist < 1 ? 0 : clamp((dx * Math.sin(listener.heading) + dz * Math.cos(listener.heading)) / dist, -1, 1);
  const gain = clamp(loudness / (1 + (dist / REFERENCE_DISTANCE) ** 1.5), 0, 1);
  return { gain, pan, delay: Math.min(dist / SPEED_OF_SOUND, MAX_DELAY) };
}
