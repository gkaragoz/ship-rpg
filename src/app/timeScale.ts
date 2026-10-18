import type { GameView } from '../core';

/** The game speeds the `+` and `-` keys step through. */
export const SPEEDS = [1, 2, 3, 5, 10] as const;

/** An enemy afloat closer than this (m) holds the game at 1×. */
export const DANGER_RANGE = 1200;

/** One step up (`+1`) or down (`-1`) the ladder; stops at both ends. */
export function stepSpeed(current: number, direction: 1 | -1): number {
  const at = Math.max(0, SPEEDS.findIndex((s) => s >= current));
  const next = Math.min(SPEEDS.length - 1, Math.max(0, at + direction));
  return SPEEDS[next] as number;
}

export type SlowReason = 'enemy' | 'shot' | 'boarding' | 'grounded' | 'sunk';

export const SLOW_REASONS: Record<SlowReason, string> = {
  enemy: 'düşman yakın',
  shot: 'top ateşi',
  boarding: 'abordaj',
  grounded: 'karaya oturdun',
  sunk: 'gemi battı',
};

/** The speed the game actually runs at: the requested one, or 1× (with the reason) whenever it would be reckless. */
export function effectiveSpeed(requested: number, view: GameView | null): { speed: number; reason: SlowReason | null } {
  if (requested <= 1 || !view) return { speed: 1, reason: null };
  if (view.sunk) return { speed: 1, reason: 'sunk' };
  if (view.grounded) return { speed: 1, reason: 'grounded' };
  if (view.boarding.available) return { speed: 1, reason: 'boarding' };
  if (view.balls.length > 0) return { speed: 1, reason: 'shot' };
  if (view.enemies.some((e) => e.sinking < 0 && e.distance < DANGER_RANGE)) return { speed: 1, reason: 'enemy' };
  return { speed: requested, reason: null };
}
