import { clamp, lerp } from '../core';
import type { WindView } from '../core';

/** Wind speed (m/s) at which a ship reaches its listed speed on its best point of sail. */
export const NOMINAL_WIND = 8;

const BASE_FROM = Math.PI / 2; // from the north (north is -z)

/** Deterministic, slowly shifting wind: a pure function of game time in seconds. */
export function windAt(time: number): WindView {
  const from = BASE_FROM + 0.45 * Math.sin(time / 97) + 0.2 * Math.sin(time / 31 + 1.3);
  const speed = 8 + 3 * Math.sin(time / 43 + 0.7) + Math.sin(time / 11);
  return { from, speed };
}

/** Polar diagram: [angle between bow and the wind's origin (rad), sail efficiency 0…1]. */
const POLAR: readonly (readonly [number, number])[] = [
  [0, 0],
  [(30 * Math.PI) / 180, 0],
  [(45 * Math.PI) / 180, 0.35],
  [(60 * Math.PI) / 180, 0.6],
  [(90 * Math.PI) / 180, 0.85],
  [(120 * Math.PI) / 180, 1],
  [(150 * Math.PI) / 180, 0.95],
  [Math.PI, 0.8],
];

/**
 * How well sails drive the ship: 0 sailing straight into the wind ("in irons"),
 * best on a broad reach, a little less running dead downwind. `angle` is the
 * unsigned angle between the bow and the direction the wind comes from.
 */
export function sailEfficiency(angle: number): number {
  const a = clamp(Math.abs(angle), 0, Math.PI);
  for (let i = 1; i < POLAR.length; i++) {
    const [a1, e1] = POLAR[i] as readonly [number, number];
    if (a <= a1) {
      const [a0, e0] = POLAR[i - 1] as readonly [number, number];
      return lerp(e0, e1, (a - a0) / (a1 - a0));
    }
  }
  return 0.8;
}
