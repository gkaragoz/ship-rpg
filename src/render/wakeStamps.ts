import type { GameView } from '../core';
import { getShipSpec } from '../ships';
import type { WakeTrails } from './wakeTrails';

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
  /** Direction the ship really travels, as a heading (leeway and shoves included); its bow's heading if omitted. */
  course?: number;
}

/** Which way the sun throws shadows (horizontal unit vector, away from the sun) and how high it stands. */
export interface SunShadow {
  dirX: number;
  dirZ: number;
  /** Elevation above the horizon, radians. */
  elevation: number;
  /** How strong the light is, 0 (out) … 1 (full sun): the shadow's darkness follows. */
  strength: number;
}

/** Stamps allowed per frame; more are dropped. */
export const MAX_STAMPS = 256;

/**
 * How much foam a ship leaves. A `deposit` is the foam a stamp leaves at one spot of the water as the ship passes over it
 * (stamp rates are worked out from it, so a long slow ship and a short fast one leave the same density, not a white-out
 * for the big one); the map's foam fades by itself and the sea shader turns it into aerated water.
 */
export const FOAM = {
  /** The ring at the waterline, per second: a faint lap at rest, livelier under way. */
  ringRest: 0.07,
  ringMoving: 0.3,
  bow: 0.95,
  wash: 1.15,
  shoulder: 0.5,
  /** The first of the diverging arms; each one further back is `armFade` as strong. */
  arm: 0.4,
  armFade: 0.72,
  /** Where the arms start behind the stern (in ship lengths, at most `armReach` metres) and how fast they spread (lateral metres per metre astern: tan 19.5°). */
  armStart: [1.0, 1.9, 2.9],
  armReach: 90,
  armSpread: 0.354,
  /** Bigger ships leave a somewhat denser, longer-lived wake: deposit × (length / 20) ^ this. */
  sizeExponent: 0.2,
} as const;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** Where a point `f` ahead and `r` to starboard of a ship at (x, z) pointing along `heading` lies. */
const along = (x: number, z: number, heading: number, f: number, r: number): [number, number] => [
  x + Math.cos(heading) * f + Math.sin(heading) * r,
  z - Math.sin(heading) * f + Math.cos(heading) * r,
];

/** Add the stamps of one moving ship for a frame of `dt` seconds in a sea of state `seaState`. */
export function shipStamps(m: ShipMotion, dt: number, seaState: number, out: Stamp[]): void {
  const s = clamp(Math.abs(m.speed) / 4, 0, 1.5);
  const lively = Math.min(s, 1);
  const rough = 1 + 0.5 * seaState;
  const L = m.length;
  const B = m.beam;
  const course = m.course ?? m.heading;
  const dir = Math.sign(m.speed) || 1;
  const run = Math.max(Math.abs(m.speed), 1);
  const size = (L / 20) ** FOAM.sizeExponent;
  // A stamp is `length` long and the ship covers it in length / run seconds, and the blob's profile averages about two thirds of
  // its length: a rate of deposit × run / (0.675 × length) leaves `deposit` at the spot the ship passed over.
  const stamp = (x: number, z: number, heading: number, length: number, width: number, deposit: number, height: number): void => {
    if (deposit === 0 && height === 0) return;
    out.push({ x, z, heading, length, width, foam: ((deposit * run) / (0.675 * length)) * dt, height: height * Math.min(1, dt * 12), kind: 0 });
  };
  if (m.sinking >= 0) {
    // a foundering hull churns the water around it
    out.push({ x: m.x, z: m.z, heading: m.heading, length: L * 1.3, width: Math.max(B * 2.4, L * 0.5), foam: 2.5 * dt, height: -0.2 * Math.min(1, dt * 12), kind: 0 });
    return;
  }
  // The waterline: a ring of foam round the hull, stronger the faster it goes and the rougher the sea.
  out.push({ x: m.x, z: m.z, heading: m.heading, length: L * 0.98, width: B * 1.25, foam: (FOAM.ringRest + FOAM.ringMoving * lively) * rough * dt, height: 0, kind: 1 });
  if (s < 0.05) return;
  const bump = lively;
  // bow wave: a crest pushed up in front, foam breaking off it
  const [bx, bz] = along(m.x, m.z, m.heading, dir * L * 0.42, 0);
  stamp(bx, bz, m.heading, L * 0.22, B * 1.05, FOAM.bow * lively * size * rough, 0.32 * bump);
  // the wash behind: a trough and dense foam, wider than the hull, laid along the way the ship goes
  const [wx, wz] = along(m.x, m.z, m.heading, -dir * L * 0.46, 0);
  stamp(wx, wz, course, L * 0.3, B * 0.85, FOAM.wash * lively * size * rough, -0.16 * bump);
  // foam at the hull's shoulders astern, and the diverging arms of the wake further back
  for (const side of [-1, 1]) {
    const [ax, az] = along(m.x, m.z, course, -dir * L * 0.34, side * B * 0.68);
    stamp(ax, az, course, L * 0.34, B * 0.3, FOAM.shoulder * lively * size, 0);
  }
  if (s < 0.4) return;
  FOAM.armStart.forEach((k, i) => {
    const back = Math.min(k * L, FOAM.armReach * (1 + i * 0.5));
    for (const side of [-1, 1]) {
      const [ax, az] = along(m.x, m.z, course, -dir * back, side * (B * 0.5 + back * FOAM.armSpread));
      stamp(ax, az, course, L * 0.4, B * 0.22, FOAM.arm * FOAM.armFade ** i * lively * size, 0.04 * lively);
    }
  });
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
    foam: Math.min(0.55, 0.2 + sun.elevation * 0.8) * sun.strength,
    height: 0,
    kind: 2,
  });
}

/** A splash or a hit: a quick burst of foam where a ball falls or strikes. */
export function impactStamp(x: number, z: number, radius: number, foam: number): Stamp {
  return { x, z, heading: 0, length: radius * 2, width: radius * 2, foam, height: 0, kind: 0 };
}

/** How fast other (patrol) ships move for the wake when nothing has been measured: about their cruising speed. */
const AMBIENT_SPEED = 4.5;

/**
 * Every stamp for this frame from the game view: the player's ship, enemies, patrol ships and the
 * splashes of the events. `dims` gives a model's size by enemy id. Only what lies within `reach` metres of
 * `(cx, cz)` (the wake map) is kept. With `trails` the foam is laid along the way each ship really goes (not where its
 * bow points), without gaps when it moves far in a frame, and the patrols' speed is the one they have over the ground.
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
  trails: WakeTrails | null = null,
): void {
  out.length = 0;
  const near = (x: number, z: number): boolean => Math.abs(x - cx) < reach && Math.abs(z - cz) < reach;
  // events first: when the cap bites it trims wake stamps, never a splash or a hit
  for (const ev of view.events) {
    if (!near(ev.x, ev.z)) continue;
    if (ev.type === 'splash') out.push(impactStamp(ev.x, ev.z, 2.6, 1.3));
    else if (ev.type === 'hit') out.push(impactStamp(ev.x, ev.z, 2.2, 0.9));
    else if (ev.type === 'sunk') out.push(impactStamp(ev.x, ev.z, 12, 3));
  }
  const ship = (key: string, x: number, z: number, heading: number, speed: number | null, d: { length: number; beam: number }, sinking: number): void => {
    if (!near(x, z)) return;
    const t = trails?.step(key, x, z, heading, dt);
    const m: ShipMotion = { x, z, heading, speed: speed ?? t?.speed ?? 0, length: d.length, beam: d.beam, sinking, course: t?.course };
    // a long move in one frame (fast game speed, a slow frame) is filled in along the path
    const gap = t ? Math.hypot(x - t.px, z - t.pz) : 0;
    const n = sinking >= 0 ? 1 : clamp(Math.ceil(gap / Math.max(d.beam * 0.9, 1)), 1, 4);
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      shipStamps(n === 1 ? m : { ...m, x: t!.px + (x - t!.px) * f, z: t!.pz + (z - t!.pz) * f }, dt / n, view.seaState, out);
    }
    if (sun) shadowStamp(m, sun, out);
  };
  if (player && !view.docked) ship('player', view.ship.x, view.ship.z, view.ship.heading, view.ship.speed, player, view.sunk ? 0 : -1);
  for (const e of view.enemies) {
    const d = dimsOf(e.id);
    if (d) ship(`e:${e.id}`, e.x, e.z, e.heading, e.speed, d, e.sinking);
  }
  for (const o of view.others) {
    const spec = getShipSpec(o.specId);
    if (spec) ship(`o:${o.id}`, o.x, o.z, o.heading, trails ? null : AMBIENT_SPEED * o.sailLevel, spec, -1);
  }
  trails?.sweep();
  if (out.length > MAX_STAMPS) out.length = MAX_STAMPS;
}
