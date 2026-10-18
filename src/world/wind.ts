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

/** How fast the bands of gusts drift downwind (m/s): two thirds of the nominal wind, a constant so the field does not smear as the wind's speed changes. */
const GUST_DRIFT = 0.65 * NOMINAL_WIND;

/**
 * Gusts: the wind is not the same everywhere. Bands of stronger and weaker air drift downwind across the sea at about
 * about 5 m/s, so a ship meets a lull or a gust at a place and a time. A multiplier on the wind's speed,
 * between 0.75 and 1.25, averaging about 1, and a pure function of position and time.
 */
export function gustAt(x: number, z: number, time: number, wind: WindView): number {
  // Wind blows towards from + π: the along-wind coordinate of a point, and the cross-wind one.
  const dx = -Math.cos(wind.from);
  const dz = Math.sin(wind.from);
  const along = x * dx + z * dz - GUST_DRIFT * time;
  const across = -x * dz + z * dx;
  const g =
    0.13 * Math.sin(along / 85 + 0.6 * Math.sin(across / 230)) +
    0.07 * Math.sin(along / 37 + across / 160 + 1.9) +
    0.04 * Math.sin(along / 19 - across / 90 + 4.1);
  return clamp(1 + g, 0.75, 1.25);
}

/**
 * The wind a moving ship feels: the true wind (blowing towards `from` + π at `speed`) less the ship's own velocity. Returned
 * like `windAt`: the direction it seems to come from (same angle convention as headings) and its speed. A ship sailing into the
 * wind feels more of it and from further ahead; running downwind, less.
 */
export function apparentWind(wind: WindView, heading: number, shipSpeed: number): WindView {
  const ax = -wind.speed * Math.cos(wind.from) - shipSpeed * Math.cos(heading);
  const az = wind.speed * Math.sin(wind.from) + shipSpeed * Math.sin(heading);
  const speed = Math.hypot(ax, az);
  if (speed < 1e-6) return { from: wind.from, speed: 0 };
  return { from: Math.atan2(az, -ax), speed };
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
