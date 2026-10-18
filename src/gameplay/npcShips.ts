import type { OtherShipView } from '../core';

/** An elliptical patrol around (cx, cz): semi-axes a (x) and b (z), starting phase, direction. */
interface Patrol {
  /** Ship spec (and GLB model) this patrol sails. */
  specId: string;
  cx: number;
  cz: number;
  a: number;
  b: number;
  phase: number;
  dir: 1 | -1;
}

/**
 * Spread from "alongside" to "on the horizon" so the level-of-detail ladder (≈60 m / ≈216 m for a
 * 12 m ship, five and eighteen lengths for bigger ones) is visible from the start: the near patrols pass within a few lengths of the player.
 */
export const PATROLS: readonly Patrol[] = [
  { specId: 'tartane', cx: 0, cz: 0, a: 70, b: 110, phase: 0.4, dir: 1 },
  { specId: 'lugger', cx: -30, cz: 50, a: 120, b: 90, phase: 1.3, dir: -1 },
  { specId: 'sloop', cx: 40, cz: -60, a: 170, b: 130, phase: 2.2, dir: -1 },
  { specId: 'schooner', cx: -120, cz: -40, a: 230, b: 170, phase: 3.0, dir: 1 },
  { specId: 'brig', cx: -80, cz: 60, a: 330, b: 260, phase: 4.1, dir: 1 },
  { specId: 'xebec', cx: 150, cz: -100, a: 300, b: 380, phase: 0.9, dir: -1 },
  { specId: 'caravel', cx: -200, cz: 150, a: 420, b: 300, phase: 2.7, dir: 1 },
  { specId: 'pinnace', cx: 60, cz: 200, a: 380, b: 450, phase: 5.0, dir: -1 },
  { specId: 'corvette', cx: -150, cz: -200, a: 520, b: 400, phase: 3.6, dir: 1 },
  { specId: 'galleon', cx: 120, cz: 90, a: 560, b: 470, phase: 5.4, dir: -1 },
  { specId: 'frigate', cx: 0, cz: -300, a: 700, b: 520, phase: 1.8, dir: 1 },
  { specId: 'battleship', cx: -50, cz: 100, a: 820, b: 640, phase: 4.6, dir: -1 },
];

/** Cruising speed of a patrol in m/s. */
export const PATROL_SPEED = 5;

export interface NpcFleet {
  update(dt: number): void;
  view(): OtherShipView[];
}

/**
 * Kinematic patrol ships on closed ellipses. Positions are an analytic function of time, so the
 * fleet is deterministic and needs no collision or steering yet.
 */
export function createNpcFleet(): NpcFleet {
  let time = 0;
  return {
    update(dt): void {
      time += dt;
    },
    view(): OtherShipView[] {
      return PATROLS.map((p, id) => {
        const omega = (p.dir * PATROL_SPEED) / ((p.a + p.b) / 2);
        const phi = p.phase + omega * time;
        // d/dt of (cx + a cos φ, cz + b sin φ) gives the velocity; heading follows (cos ψ, -sin ψ).
        const vx = -p.a * Math.sin(phi) * omega;
        const vz = p.b * Math.cos(phi) * omega;
        return {
          id,
          specId: p.specId,
          x: p.cx + p.a * Math.cos(phi),
          z: p.cz + p.b * Math.sin(phi),
          heading: Math.atan2(-vz, vx),
          sailLevel: 0.8,
          roll: 0.03 * Math.sin(0.7 * time + id),
        };
      });
    },
  };
}
