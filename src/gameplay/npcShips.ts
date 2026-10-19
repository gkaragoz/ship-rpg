import type { OtherShipView, WindView } from '../core';
import { terrainHeight, windAt } from '../world';
import { getShipSpec } from '../ships';
import { apparentView } from './enemyView';
import { createTraffic } from './traffic';

/** An elliptical patrol around (cx, cz): semi-axes a (x) and b (z), starting phase, direction. */
interface Patrol {
  /** Ship spec (and GLB model) this patrol sails. */
  specId: string;
  /** Nation whose ensign it flies (decoration until factions arrive, slice 5e). */
  nation: string;
  cx: number;
  cz: number;
  a: number;
  b: number;
  phase: number;
  dir: 1 | -1;
}

/**
 * Spread from "alongside" to "on the horizon" so the whole level-of-detail ladder is visible from
 * the start (switches at 5 and 18 ship lengths, e.g. about 60 m and 216 m for a 12 m ship): the
 * near patrols pass within a few lengths of the player, the big ships circle far out.
 */
export const PATROLS: readonly Patrol[] = [
  { specId: 'tartane', nation: 'english', cx: 0, cz: 0, a: 70, b: 110, phase: 0.4, dir: 1 },
  { specId: 'lugger', nation: 'french', cx: -30, cz: 50, a: 120, b: 90, phase: 1.3, dir: -1 },
  { specId: 'sloop', nation: 'dutch', cx: 40, cz: -60, a: 170, b: 130, phase: 2.2, dir: -1 },
  { specId: 'schooner', nation: 'spanish', cx: -120, cz: -40, a: 230, b: 170, phase: 3.0, dir: 1 },
  { specId: 'brig', nation: 'english', cx: -80, cz: 60, a: 330, b: 260, phase: 4.1, dir: 1 },
  { specId: 'xebec', nation: 'pirate', cx: 150, cz: -100, a: 300, b: 380, phase: 0.9, dir: -1 },
  { specId: 'caravel', nation: 'spanish', cx: -200, cz: 150, a: 420, b: 300, phase: 2.7, dir: 1 },
  { specId: 'pinnace', nation: 'dutch', cx: 60, cz: 200, a: 380, b: 450, phase: 5.0, dir: -1 },
  { specId: 'corvette', nation: 'french', cx: -150, cz: -200, a: 520, b: 400, phase: 3.6, dir: 1 },
  { specId: 'galleon', nation: 'spanish', cx: 120, cz: 90, a: 560, b: 470, phase: 5.4, dir: -1 },
  { specId: 'frigate', nation: 'english', cx: 0, cz: -300, a: 700, b: 520, phase: 1.8, dir: 1 },
  { specId: 'battleship', nation: 'french', cx: -50, cz: 100, a: 820, b: 640, phase: 4.6, dir: -1 },
];

/** The sea floor must be deeper than this under every point of a patrol. */
const CLEAR_DEPTH = -4;
const LAND_SAMPLES = 96;

const landPoints = (p: Patrol): number => {
  let n = 0;
  for (let i = 0; i < LAND_SAMPLES; i++) {
    const f = (i / LAND_SAMPLES) * 2 * Math.PI;
    if (terrainHeight(p.cx + p.a * Math.cos(f), p.cz + p.b * Math.sin(f)) > CLEAR_DEPTH) n++;
  }
  return n;
};

/**
 * Put the patrols around `origin` (where the player starts) on open water: each keeps its shape and
 * moves to the nearest centre, searched outwards in rings, whose whole ellipse is clear of land and
 * shoals. If none is, the least-obstructed candidate wins.
 */
export function placePatrols(origin: { x: number; z: number }): Patrol[] {
  return PATROLS.map((p) => {
    let best = { ...p, cx: origin.x + p.cx, cz: origin.z + p.cz };
    let bestLand = landPoints(best);
    for (let ring = 1; ring <= 24 && bestLand > 0; ring++) {
      for (let k = 0; k < 12 && bestLand > 0; k++) {
        const ang = (k / 12) * 2 * Math.PI + ring;
        const c = { ...p, cx: origin.x + p.cx + Math.cos(ang) * ring * 120, cz: origin.z + p.cz + Math.sin(ang) * ring * 120 };
        const land = landPoints(c);
        if (land < bestLand) {
          best = c;
          bestLand = land;
        }
      }
    }
    return best;
  });
}

/** Cruising speed of a patrol in m/s. */
export const PATROL_SPEED = 5;

/** A ship the patrols give way to: where it is and how long. */
export interface WayShip {
  x: number;
  z: number;
  length: number;
}

/** Clear water kept between two hulls beyond their half lengths (m), and the most a patrol is ever turned aside (m). */
export const PATROL_CLEARANCE = 28;
const MAX_AVOID = 70;

/**
 * How far each patrol is steered off its rail to keep clear of the others: a stateless push along the line between two
 * ships that grows as they close, shared between two patrols and borne wholly by a patrol giving way to a ship that is
 * not on rails. Because it depends only on where everybody is, nobody ever jumps. Returns `[dx, dz]` per patrol.
 */
export function avoidanceOffsets(patrols: readonly { x: number; z: number; length: number }[], giveWay: readonly WayShip[] = []): [number, number][] {
  return patrols.map((p, i) => {
    let ox = 0;
    let oz = 0;
    const push = (x: number, z: number, length: number, share: number): void => {
      const dx = p.x - x;
      const dz = p.z - z;
      const d = Math.hypot(dx, dz) || 0.001;
      const safe = (p.length + length) / 2 + PATROL_CLEARANCE;
      if (d >= safe) return;
      const k = ((safe - d) * share) / d;
      ox += dx * k;
      oz += dz * k;
    };
    patrols.forEach((q, j) => {
      if (j !== i) push(q.x, q.z, q.length, 0.5);
    });
    for (const o of giveWay) push(o.x, o.z, o.length, 1);
    const m = Math.hypot(ox, oz);
    return m > MAX_AVOID ? [(ox / m) * MAX_AVOID, (oz / m) * MAX_AVOID] : [ox, oz];
  });
}

/** Seconds in which a patrol that was shoved sails back onto its rail (time constant of the decay). */
export const PATROL_RECOVERY = 5;

export interface NpcFleet {
  /** Ships before this id are patrols; from it on they are merchants (the ones that can be shot at). */
  readonly firstMerchantId: number;
  update(dt: number): void;
  /** Shove patrol `id` aside by (dx, dz) metres and turn it by `dyaw` radians (a crash); it drifts back onto its rail. */
  nudge(id: number, dx: number, dz: number, dyaw: number): void;
  /**
   * The patrols now; `wind` is the true wind they are sailing in (for the apparent wind they feel). With `giveWay` (the
   * ships the patrols steer clear of, besides each other: the player, the enemies; may be empty) they sheer off to keep
   * clear of each other; without it they are on their rails exactly.
   */
  view(wind?: WindView, giveWay?: readonly WayShip[]): OtherShipView[];
}

/**

 * Patrol ships on closed ellipses. Where a patrol would be is an analytic function of time, so the fleet is deterministic;
 * a crash shoves one off its rail (`nudge`) and the shove then fades away, so a patrol that was hit sails back onto its ellipse.
 */
export function createNpcFleet(origin: { x: number; z: number } = { x: 0, z: 0 }): NpcFleet {
  const patrols = placePatrols(origin);
  const traffic = createTraffic();
  const firstMerchantId = patrols.length; // merchants sailing from port to port; their ids follow the patrols'
  const shoved = patrols.map(() => ({ x: 0, z: 0, yaw: 0 }));
  let time = 0;
  return {
    firstMerchantId,
    update(dt): void {
      time += dt;
      const keep = Math.exp(-dt / PATROL_RECOVERY);
      for (const s of shoved) {
        s.x *= keep;
        s.z *= keep;
        s.yaw *= keep;
      }
    },
    nudge(id, dx, dz, dyaw): void {
      const s = shoved[id];
      if (!s) return;
      s.x += dx;
      s.z += dz;
      s.yaw += dyaw;
    },
    view(wind: WindView = windAt(time), giveWay?: readonly WayShip[]): OtherShipView[] {
      const rails = patrols.map((p, id) => {
        const s = shoved[id]!;
        const omega = (p.dir * PATROL_SPEED) / ((p.a + p.b) / 2);
        const phi = p.phase + omega * time;
        // d/dt of (cx + a cos φ, cz + b sin φ) gives the velocity; heading follows (cos ψ, -sin ψ).
        const vx = -p.a * Math.sin(phi) * omega;
        const vz = p.b * Math.cos(phi) * omega;
        return {
          id,
          specId: p.specId,
          nation: p.nation,
          x: p.cx + p.a * Math.cos(phi) + s.x,
          z: p.cz + p.b * Math.sin(phi) + s.z,
          heading: Math.atan2(-vz, vx) + s.yaw,
          sailLevel: 0.8,
          roll: 0.03 * Math.sin(0.7 * time + id),
          apparent: apparentView(wind, Math.atan2(-vz, vx) + s.yaw, PATROL_SPEED),
        };
      });
      const raw = [...rails, ...traffic.views(time, wind, patrols.length)];
      if (!giveWay) return raw; // on their rails exactly
      // steer clear of each other and of the ships that give them no way (the player, the enemies)
      const away = avoidanceOffsets(raw.map((o) => ({ x: o.x, z: o.z, length: getShipSpec(o.specId)?.length ?? 20 })), giveWay);
      return raw.map((o, i) => {
        const [dx, dz] = away[i] as [number, number];
        return dx === 0 && dz === 0 ? o : { ...o, x: o.x + dx, z: o.z + dz };
      });
    },
  };
}
