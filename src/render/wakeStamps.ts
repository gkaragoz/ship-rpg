import type { GameView } from '../core';
import { getShipSpec } from '../ships';

/**
 * What a ship (or a cannonball) leaves on the water: soft shapes, in world metres, that `wake.ts` paints into
 * the foam and ripple map. `foam` is the amount painted at the centre, `height` the bump (m) pushed into the
 * surface there. Amounts of a moving ship are per frame (already times `dt`); impacts are one-off.
 */
export interface Stamp {
  x: number;
  z: number;
  /** Direction the long axis points, as a ship heading (bow along (cos, -sin)). */
  heading: number;
  /** Full length and width of the ellipse (m). */
  length: number;
  width: number;
  foam: number;
  height: number;
  /** 0 a soft blob; 1 a ring (foam along the hull's waterline); 2 a ship's shadow (written to the map's blue channel, `foam` is its darkness). */
  kind: 0 | 1 | 2;
}

export interface ShipMotion {
  x: number;
  z: number;
  heading: number;
  /** m/s, negative astern. */
  speed: number;
  length: number;
  beam: number;
  /** Seconds since it began to sink, or -1 while afloat. */
  sinking: number;
}

/** Which way the sun throws shadows (horizontal unit vector, away from the sun) and how high it stands. */
export interface SunShadow {
  dirX: number;
  dirZ: number;
  /** Elevation above the horizon, radians. */
  elevation: number;
}

/** Stamps allowed per frame; more are dropped. */
export const MAX_STAMPS = 96;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** Where a point `f` ahead and `r` to starboard of the ship lies. */
const at = (m: ShipMotion, f: number, r: number): [number, number] => [
  m.x + Math.cos(m.heading) * f + Math.sin(m.heading) * r,
  m.z - Math.sin(m.heading) * f + Math.cos(m.heading) * r,
];

/** Add the stamps of one moving ship for a frame of `dt` seconds in a sea of state `seaState`. */
export function shipStamps(m: ShipMotion, dt: number, seaState: number, out: Stamp[]): void {
  const s = clamp(Math.abs(m.speed) / 4, 0, 1.5);
  const choppy = 1 + seaState;
  const L = m.length;
  const B = m.beam;
  const push = (f: number, r: number, length: number, width: number, foam: number, height: number, kind: 0 | 1 = 0): void => {
    if (foam === 0 && height === 0) return;
    const [x, z] = at(m, f, r);
    out.push({ x, z, heading: m.heading, length, width, foam: foam * dt, height: height * Math.min(1, dt * 12), kind });
  };
  if (m.sinking >= 0) {
    // a foundering hull churns the water around it
    push(0, 0, L * 1.3, Math.max(B * 2.4, L * 0.5), 2.5, -0.2);
    return;
  }
  // The waterline: a ring of foam round the hull, stronger the faster it goes and the rougher the sea.
  push(0, 0, L * 0.98, B * 1.25, (0.12 + 0.9 * s) * choppy * 0.6, 0, 1);
  if (s < 0.05) return;
  const dir = Math.sign(m.speed) || 1;
  // bow wave: a crest pushed up in front, foam breaking off it
  push(dir * L * 0.42, 0, L * 0.22, B * 1.05, 1.5 * s, 0.32 * Math.min(s, 1));
  // the wash behind: a trough and a lot of foam, wider than the hull, and two arms that spread behind
  push(-dir * L * 0.46, 0, L * 0.3, B * 0.85, 2.4 * s, -0.16 * Math.min(s, 1));
  for (const side of [-1, 1]) push(-dir * L * 0.34, side * B * 0.68, L * 0.34, B * 0.3, 1.1 * s, 0);
}

/**
 * The shadow a ship casts on the sea: a soft ellipse along the sun's direction, as long as the ship's silhouette
 * seen from the sun plus the reach of its masts at this sun height; a low sun throws long shadows.
 */
export function shadowStamp(m: ShipMotion, sun: SunShadow, out: Stamp[]): void {
  if (m.sinking >= 0 || sun.elevation <= 0.05) return;
  const height = m.length * 0.75;
  const reach = Math.min(height / Math.tan(sun.elevation), m.length * 3);
  // the ship's footprint along and across the sun's direction
  const rel = Math.atan2(-sun.dirZ, sun.dirX) - m.heading;
  const along = Math.abs(Math.cos(rel)) * m.length + Math.abs(Math.sin(rel)) * m.beam;
  const across = Math.abs(Math.sin(rel)) * m.length * 0.6 + Math.abs(Math.cos(rel)) * m.beam;
  const length = along + reach;
  const shift = reach / 2;
  out.push({
    x: m.x + sun.dirX * shift,
    z: m.z + sun.dirZ * shift,
    heading: Math.atan2(-sun.dirZ, sun.dirX),
    length,
    width: across * 1.1,
    foam: Math.min(0.55, 0.2 + sun.elevation * 0.8),
    height: 0,
    kind: 2,
  });
}

/** A splash or a hit: a quick burst of foam where a ball falls or strikes. */
export function impactStamp(x: number, z: number, radius: number, foam: number): Stamp {
  return { x, z, heading: 0, length: radius * 2, width: radius * 2, foam, height: 0, kind: 0 };
}

/** How fast other (patrol) ships move for the wake: about their cruising speed. */
const AMBIENT_SPEED = 4.5;

/**
 * Every stamp for this frame from the game view: the player's ship, enemies, patrol ships and the
 * splashes of the events. `dims` gives a model's size by enemy id. Only what lies within `reach` metres of
 * `(cx, cz)` (the wake map) is kept.
 */
export function collectStamps(
  view: GameView,
  dt: number,
  player: { length: number; beam: number } | null,
  dimsOf: (enemyId: string) => { length: number; beam: number } | null,
  cx: number,
  cz: number,
  reach: number,
  out: Stamp[],
  sun: SunShadow | null = null,
): void {
  out.length = 0;
  const near = (x: number, z: number): boolean => Math.abs(x - cx) < reach && Math.abs(z - cz) < reach;
  const ship = (x: number, z: number, heading: number, speed: number, d: { length: number; beam: number }, sinking: number): void => {
    if (!near(x, z)) return;
    const m = { x, z, heading, speed, length: d.length, beam: d.beam, sinking };
    shipStamps(m, dt, view.seaState, out);
    if (sun) shadowStamp(m, sun, out);
  };
  if (player && !view.docked) ship(view.ship.x, view.ship.z, view.ship.heading, view.ship.speed, player, view.sunk ? 0 : -1);
  for (const e of view.enemies) {
    const d = dimsOf(e.id);
    if (d) ship(e.x, e.z, e.heading, e.speed, d, e.sinking);
  }
  for (const o of view.others) {
    const spec = getShipSpec(o.specId);
    if (spec) ship(o.x, o.z, o.heading, AMBIENT_SPEED * o.sailLevel, spec, -1);
  }
  for (const ev of view.events) {
    if (!near(ev.x, ev.z)) continue;
    if (ev.type === 'splash') out.push(impactStamp(ev.x, ev.z, 2.6, 1.3));
    else if (ev.type === 'hit') out.push(impactStamp(ev.x, ev.z, 2.2, 0.9));
    else if (ev.type === 'sunk') out.push(impactStamp(ev.x, ev.z, 12, 3));
  }
  if (out.length > MAX_STAMPS) out.length = MAX_STAMPS;
}
