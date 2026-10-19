import type { ShipSpec } from '../ships';
import { SAILING, isBlocked, type PlayerShip } from './sailing';
import { strike } from './damage';

/**
 * Ship against ship. Each hull is an oriented box (its length by its beam) with a mass from its displacement.
 * Two boxes that overlap are pushed apart along the axis of least overlap and trade an impulse along it
 * (a little bouncy, a little lossy); the impulse becomes a change of each ship's speed along its keel and a
 * nudge of its heading from the off-centre contact. What the crash cost is the energy lost, shared by how
 * strong each hull is: a small ship rammed by a big one comes off far worse than the big one.
 */
export const COLLISION = {
  /** Fraction of the closing speed that comes back (wood on wood absorbs most of it). */
  restitution: 0.2,
  /** Closing speed (m/s) below which a touch is a scrape: it bounces but breaks nothing. */
  scrape: 1,
  /** Hull fraction lost = lost energy (kJ) / (hull mass (t) × this); about 7 % for a brig ramming a brig at 6 m/s. */
  toughness: 120,
  /** Radians of turn per unit of angular impulse: how fast a glancing blow swings the bow. */
  swing: 0.6,
  /** Most a single contact may turn a ship (rad). */
  maxSwing: 0.35,
  /** Fastest the bow may be swinging after crashes (rad/s). */
  maxSpin: 0.45,
  /** The box is a little smaller than the full length and beam: the bow and stern are pointed, not square. */
  lengthFit: 0.46,
  beamFit: 0.42,
  /** Fastest a crash may throw a ship astern (m/s), as in a grounding. */
  maxSternway: 1.5,
  /** Closing speed (m/s) above which the blow opens the hull below the waterline. */
  holing: 3,
} as const;

/** Displacement in tonnes (m³ of water) of a hull: its box times a fullness of about a half. */
export const hullMass = (spec: ShipSpec): number => spec.length * spec.beam * spec.draft * 0.5;

/** One hull in the crash resolver. A `fixed` hull (a patrol on its rails) carries a velocity and is never pushed. */
export interface Hull {
  /** Hulls of one group never collide with each other (the patrols, which cross each other's rails). */
  group?: string;
  ship: Pick<PlayerShip, 'x' | 'z' | 'heading' | 'speed'> & Partial<PlayerShip>;
  spec: ShipSpec;
  maxHp: number;
  /** A kinematic hull: moves on its own, takes no damage, ignores impulses. */
  fixed?: { vx: number; vz: number };
}

/** What a crash did: where, how hard, and the hull points each side lost. */
export interface Impact {
  /** World contact point, and the unit normal pointing from `a` to `b`. */
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** Closing speed along the normal (m/s). */
  speed: number;
  a: number;
  b: number;
  lostA: number;
  lostB: number;
  /** The blow opened a hull below the waterline. */
  holed: boolean;
}

interface Box {
  x: number;
  z: number;
  /** Unit forward and starboard axes. */
  fx: number;
  fz: number;
  sx: number;
  sz: number;
  hl: number;
  hb: number;
}

const boxOf = (h: Hull): Box => {
  const c = Math.cos(h.ship.heading);
  const s = Math.sin(h.ship.heading);
  return { x: h.ship.x, z: h.ship.z, fx: c, fz: -s, sx: s, sz: c, hl: h.spec.length * COLLISION.lengthFit, hb: h.spec.beam * COLLISION.beamFit };
};

/** Half-extent of a box along a unit axis. */
const reach = (b: Box, ax: number, az: number): number => b.hl * Math.abs(b.fx * ax + b.fz * az) + b.hb * Math.abs(b.sx * ax + b.sz * az);

/** Separating-axis test of two boxes: the axis of least overlap (pointing from a to b) and the depth, or null. */
export function overlap(a: Box, b: Box): { nx: number; nz: number; depth: number } | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let best: { nx: number; nz: number; depth: number } | null = null;
  for (const [ax, az] of [[a.fx, a.fz], [a.sx, a.sz], [b.fx, b.fz], [b.sx, b.sz]] as const) {
    const d = dx * ax + dz * az;
    const depth = reach(a, ax, az) + reach(b, ax, az) - Math.abs(d);
    if (depth <= 0) return null;
    if (!best || depth < best.depth) best = d >= 0 ? { nx: ax, nz: az, depth } : { nx: -ax, nz: -az, depth };
  }
  return best;
}

/** Velocity of a hull as a vector: along its keel at its speed, or the patrol's own. */
const velocity = (h: Hull): [number, number] =>
  h.fixed ? [h.fixed.vx, h.fixed.vz] : [Math.cos(h.ship.heading) * h.ship.speed, -Math.sin(h.ship.heading) * h.ship.speed];

/** Turn a hull by the angular impulse of an off-centre contact (the world has z flipped against heading's angle). */
function swing(h: Hull, rx: number, rz: number, jx: number, jz: number, mass: number): void {
  if (h.fixed) return;
  const inertia = (mass * (h.spec.length ** 2 + h.spec.beam ** 2)) / 12;
  const torque = rx * -jz - -rz * jx; // z up is -z here
  const turn = Math.max(-COLLISION.maxSwing, Math.min(COLLISION.maxSwing, (torque / inertia) * COLLISION.swing));
  // A ship with a state of its own takes the swing as a yaw rate the water damps out (it integrates to `turn`), so the
  // bow comes round over a moment instead of snapping; a hull without one (a patrol) is turned at once.
  if (typeof h.ship.spin === 'number') h.ship.spin = Math.max(-COLLISION.maxSpin, Math.min(COLLISION.maxSpin, h.ship.spin + turn / SAILING.spinDecay));
  else h.ship.heading += turn;
}

/** Resolve the crash of one pair, if they touch. Moves the hulls apart, changes speeds and headings, returns the impact. */
export function collide(a: Hull, b: Hull): Omit<Impact, 'a' | 'b'> | null {
  const boxA = boxOf(a);
  const boxB = boxOf(b);
  const hit = overlap(boxA, boxB);
  if (!hit) return null;
  const ma = a.fixed ? Infinity : hullMass(a.spec);
  const mb = b.fixed ? Infinity : hullMass(b.spec);
  const invA = a.fixed ? 0 : 1 / ma;
  const invB = b.fixed ? 0 : 1 / mb;
  if (invA + invB === 0) return null;
  // Push apart in proportion to how light each one is.
  const share = hit.depth + 0.02;
  a.ship.x -= hit.nx * share * (invA / (invA + invB));
  a.ship.z -= hit.nz * share * (invA / (invA + invB));
  b.ship.x += hit.nx * share * (invB / (invA + invB));
  b.ship.z += hit.nz * share * (invB / (invA + invB));
  const [vax, vaz] = velocity(a);
  const [vbx, vbz] = velocity(b);
  const closing = -((vbx - vax) * hit.nx + (vbz - vaz) * hit.nz); // > 0 when they approach
  const reach_a = reach(boxA, hit.nx, hit.nz);
  const px = boxA.x + hit.nx * (reach_a - hit.depth / 2);
  const pz = boxA.z + hit.nz * (reach_a - hit.depth / 2);
  if (closing <= 0) return { x: px, z: pz, nx: hit.nx, nz: hit.nz, speed: 0, lostA: 0, lostB: 0, holed: false };
  const j = ((1 + COLLISION.restitution) * closing) / (invA + invB);
  const jx = hit.nx * j;
  const jz = hit.nz * j;
  // The keel resists sliding sideways, so only the part along the keel changes the speed; the rest swings the bow.
  for (const [h, inv, sign] of [[a, invA, -1], [b, invB, 1]] as const) {
    if (h.fixed) continue;
    const dvx = sign * jx * inv;
    const dvz = sign * jz * inv;
    const along = dvx * Math.cos(h.ship.heading) - dvz * Math.sin(h.ship.heading);
    h.ship.speed += along;
    h.ship.speed = Math.max(h.ship.speed, -COLLISION.maxSternway); // a rebound is a shove, not a reverse gear
    const mass = hullMass(h.spec);
    swing(h, px - h.ship.x, pz - h.ship.z, sign * jx, sign * jz, mass);
  }
  // Energy lost in the crash, shared by how strong each hull is.
  const reduced = 1 / (1 / hullMass(a.spec) + 1 / hullMass(b.spec)); // a patrol on its rails still weighs what it weighs
  const lostEnergy = 0.5 * reduced * (1 - COLLISION.restitution ** 2) * Math.max(0, closing ** 2 - COLLISION.scrape ** 2);
  const lossOf = (h: Hull, mass: number): number => (h.fixed || lostEnergy <= 0 ? 0 : Math.min(0.3, lostEnergy / (mass * COLLISION.toughness)) * h.maxHp);
  const holed = closing > COLLISION.holing;
  return { x: px, z: pz, nx: hit.nx, nz: hit.nz, speed: closing, lostA: lossOf(a, ma), lostB: lossOf(b, mb), holed };
}

/**
 * Resolve every pair among `hulls` (a few ships: a pairwise sweep is plenty). Ships the crash pushes onto shoals are
 * put back where they were. The damage is applied to the ships here (`strike`) and reported in each impact for the hit points.
 */
export function collideAll(hulls: readonly Hull[]): Impact[] {
  const impacts: Impact[] = [];
  const before = hulls.map((h) => ({ x: h.ship.x, z: h.ship.z, heading: h.ship.heading }));
  for (let i = 0; i < hulls.length; i++) {
    for (let j = i + 1; j < hulls.length; j++) {
      const a = hulls[i]!;
      const b = hulls[j]!;
      if (a.group !== undefined && a.group === b.group) continue;
      if (Math.hypot(a.ship.x - b.ship.x, a.ship.z - b.ship.z) > (a.spec.length + b.spec.length) * 0.6) continue;
      const r = collide(a, b);
      if (!r) continue;
      if (r.lostA > 0 || r.lostB > 0) {
        for (const [h, lost] of [[a, r.lostA], [b, r.lostB]] as const) {
          if (lost <= 0 || h.fixed) continue;
          const ship = h.ship as PlayerShip;
          strike(ship, 'hull', lost, h.maxHp, 1);
          if (r.holed) ship.flooding = Math.min(1, ship.flooding + (lost / h.maxHp) * 1.5); // a hard blow opens the planking below the waterline
        }
      }
      impacts.push({ ...r, a: i, b: j });
    }
  }
  hulls.forEach((h, i) => {
    if (h.fixed) return;
    if (isBlocked(h.ship, h.spec)) {
      h.ship.x = before[i]!.x;
      h.ship.z = before[i]!.z;
      h.ship.heading = before[i]!.heading;
      if (typeof h.ship.spin === 'number') h.ship.spin = 0;
    }
  });
  return impacts;
}
