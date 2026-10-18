import type { GameEvent } from '../core';

/**
 * Camera shake: a number that jumps with what happens to the player and dies away; the camera is moved by a random offset
 * of `OFFSET` metres per unit of it while drawing. Kept small: a crash or a broadside should be felt, not make the view hard to read.
 */
export const SHAKE = {
  /** Per unit of shake, the most the camera moves along an axis (m, half-width of the random offset). */
  offset: 0.45,
  /** How fast it dies away (units per second). */
  decay: 4,
  /** A ball hitting the player: a base and a part by the hull points it took, and the most a hit can build up. */
  hit: { base: 0.15, perPoint: 1 / 900, max: 0.6 },
  /** One of the player's own guns firing. */
  fire: { step: 0.02, max: 0.3 },
  /** The player's ship meeting another: a base and a part by the closing speed (m/s). */
  crash: { base: 0.08, perSpeed: 1 / 24, max: 0.45 },
} as const;

/** The shake after the events of a frame have added to it. */
export function addShake(shake: number, events: readonly GameEvent[]): number {
  let s = shake;
  for (const e of events) {
    if (e.type === 'hit' && e.owner === 'enemy') s = Math.min(SHAKE.hit.max, s + SHAKE.hit.base + (e.amount ?? 0) * SHAKE.hit.perPoint);
    else if (e.type === 'fire' && e.owner === 'player') s = Math.min(SHAKE.fire.max, s + SHAKE.fire.step);
    else if (e.type === 'collision' && e.owner === 'player') s = Math.min(SHAKE.crash.max, s + SHAKE.crash.base + (e.speed ?? 0) * SHAKE.crash.perSpeed);
  }
  return s;
}

/** The shake `dt` seconds later. */
export const decayShake = (shake: number, dt: number): number => Math.max(0, shake - dt * SHAKE.decay);
