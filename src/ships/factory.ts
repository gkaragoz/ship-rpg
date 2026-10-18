import * as THREE from 'three';
import type { ShipSpec } from './types';
import { createMaterials, disposeMaterials } from './materials';
import { buildHull } from './hull';
import { buildCastles } from './castles';
import { buildGunPorts, buildLanterns, buildOars, buildSternWindows } from './details';
import { buildRig } from './rig';

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface Ship {
  readonly spec: ShipSpec;
  /** Origin at the waterline amidships; +x is the bow. */
  readonly root: THREE.Group;
  /**
   * Trim sails for the wind. `windRel` is the signed angle from the bow to the wind's
   * origin (+ = wind from port); `level` is sail deployment 0 (furled) … 1 (full).
   */
  setSailTrim(windRel: number, level: number): void;
  /** Frees geometries and materials created for this ship. */
  dispose(): void;
}

export function createShip(spec: ShipSpec): Ship {
  const mats = createMaterials(spec);
  const root = new THREE.Group();
  root.name = spec.id;
  root.add(buildHull(spec, mats), ...buildCastles(spec, mats), buildRig(spec, mats));
  for (const part of [buildGunPorts(spec, mats), buildOars(spec, mats), buildSternWindows(spec, mats), buildLanterns(spec, mats)]) {
    if (part) root.add(part);
  }
  const square: THREE.Object3D[] = [];
  const aft: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name === 'trim-square') square.push(o);
    else if (o.name === 'trim-aft') aft.push(o);
  });

  return {
    spec,
    root,
    setSailTrim(windRel, level): void {
      const side = windRel >= 0 ? 1 : -1;
      // Closer to the wind: yards braced hard round, fore-and-aft sails sheeted in.
      const downwind = smoothstep(0.7, 3.0, Math.abs(windRel));
      const brace = 0.65 * (1 - downwind);
      const sheet = 0.08 + 1.02 * downwind;
      const lv = clamp(level, 0, 1);
      const shown = lv > 0.05;
      const height = 0.35 + 0.65 * lv;
      for (const o of square) {
        o.visible = shown;
        o.rotation.y = side * brace;
        o.scale.set(1, height, 1);
      }
      for (const o of aft) {
        o.visible = shown;
        o.rotation.y = side * sheet;
        o.scale.set(1, height, side); // mirrored so the sail always bellies to leeward
      }
    },
    dispose(): void {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose(); // instance matrix buffer
      });
      disposeMaterials(mats);
    },
  };
}
