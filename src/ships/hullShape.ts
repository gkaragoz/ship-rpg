import { Vector3 } from 'three';
import type { ShipSpec } from './types';

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
const smooth = (x: number): number => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/** Cross-section exponent: <1 gives a fuller, boxier U-section. */
const SECTION_FULLNESS = 0.6;
const DEPTH_EXPONENT = 0.8;

/**
 * Hull math. `t` runs along the hull from stern (0) to bow (1); `s` runs around a
 * cross-section from the port deck edge (0) through the keel (0.5) to starboard (1).
 */
export function halfBeam(spec: ShipSpec, t: number): number {
  const base = spec.beam / 2;
  if (t >= 0.5) {
    const u = (t - 0.5) * 2;
    return base * Math.max((1 - u ** 1.7) ** 0.75, 0.03);
  }
  const u = (0.5 - t) * 2;
  return base * (1 - 0.22 * u * u);
}

export function deckHeight(spec: ShipSpec, t: number): number {
  return spec.freeboard + spec.sheer * (0.6 * (1 - t) ** 2 + t ** 2.5);
}

export function keelHeight(spec: ShipSpec, t: number): number {
  const bow = smooth((t - 0.6) / 0.4);
  const stern = smooth((0.25 - t) / 0.25);
  return -spec.draft * (1 - 0.7 * bow - 0.3 * stern);
}

export function sectionPoint(spec: ShipSpec, t: number, s: number): Vector3 {
  const hw = halfBeam(spec, t);
  const top = deckHeight(spec, t);
  const keel = keelHeight(spec, t);
  const theta = s * Math.PI;
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  const z = -Math.sign(c) * hw * Math.abs(c) ** SECTION_FULLNESS;
  const y = top + (keel - top) * sn ** DEPTH_EXPONENT;
  // Stem and transom lean outward at deck level.
  const open = 1 - sn;
  const x = (t - 0.5) * spec.length + spec.length * (0.05 * t ** 3 - 0.02 * (1 - t) ** 3) * open;
  return new Vector3(x, y, z);
}

/** Starboard hull-side point `drop` metres below the deck edge at station `t`. */
export function sidePoint(spec: ShipSpec, t: number, drop: number): Vector3 {
  const range = deckHeight(spec, t) - keelHeight(spec, t);
  const theta = Math.asin(clamp01(drop / range) ** (1 / DEPTH_EXPONENT));
  return sectionPoint(spec, t, 1 - theta / Math.PI);
}

/** Height of the bulwark (rail) above the deck; the deck sits this far below the hull top. */
export function bulwark(spec: ShipSpec): number {
  return Math.min(Math.max(0.2 + 0.017 * spec.length, 0.5), 1.2);
}
