import * as THREE from 'three';
import type { GameView } from '../core';
import { lodUpdateDue, selectLod, type Ship, type ShipLod } from '../ships';
import { rideWaves } from './ride';

/** Ships farther than this are skipped entirely (the fog hides them anyway). */
const CULL_DISTANCE = 1100;

export interface Fleet {
  /** The ship objects for `GameView.others`; ship `i` draws `others[i]` (matched by id). */
  setShips(ships: Ship[]): void;
  update(view: GameView, camera: THREE.Camera, ampScale: number): void;
  /** Debug: draw every other ship at this LOD regardless of distance (null = automatic). */
  setOverride(lod: ShipLod | null): void;
  /** How many other ships currently use LOD 0, 1 and 2. */
  lodCounts(): [number, number, number];
  dispose(): void;
}

/**
 * Other ships at sea. Each is placed on the waves and switched between LODs by distance to the
 * camera, re-evaluated on a staggered schedule with hysteresis (see `selectLod`). The
 * player's ship is not part of the fleet and always stays at full quality.
 */
export function createFleet(scene: THREE.Scene): Fleet {
  let ships: Ship[] = [];
  let levels: (ShipLod | null)[] = [];
  let frame = 0;
  let override: ShipLod | null = null;
  const counts: [number, number, number] = [0, 0, 0];

  return {
    setShips(next): void {
      for (const s of ships) scene.remove(s.root);
      ships = next;
      levels = next.map(() => null);
      for (const s of ships) scene.add(s.root);
    },

    setOverride(lod): void {
      override = lod;
      levels = levels.map(() => null); // re-evaluate every ship on the next update
    },

    update(view, camera, ampScale): void {
      frame++;
      counts.fill(0);
      for (const o of view.others) {
        const ship = ships[o.id];
        if (!ship) continue;
        const dims = { length: ship.spec.length, beam: ship.spec.beam };
        const distance = Math.hypot(o.x - camera.position.x, o.z - camera.position.z);
        ship.root.visible = distance < CULL_DISTANCE;
        if (!ship.root.visible) continue;

        const prev = levels[o.id] ?? null;
        let lod: ShipLod = prev ?? 0;
        if (prev === null || lodUpdateDue(frame, o.id)) {
          lod = override ?? selectLod(distance, dims.length, prev);
          if (lod !== prev) ship.setLod?.(lod);
          levels[o.id] = lod;
          ship.setSailTrim(o.apparent.angle, o.sailLevel);
        }
        counts[lod]++;
        rideWaves(ship.root, o, dims, view.time, view.wind.from, ampScale, lod < 2, 0, view.weather.tuning);
      }
    },

    lodCounts: () => [counts[0], counts[1], counts[2]],

    dispose(): void {
      for (const s of ships) {
        scene.remove(s.root);
        s.dispose();
      }
      ships = [];
    },
  };
}
