import type * as THREE from 'three';
import { clamp, smoothstep } from '../core';

/**
 * Sail nodes the game rotates when the wind or the sail level changes. Procedural ships name
 * them `trim-square` / `trim-aft`; GLB ships prefix a LOD (`LOD1_trim-aft`), hence `endsWith`.
 */
export interface SailNodes {
  square: THREE.Object3D[];
  aft: THREE.Object3D[];
}

export function collectSailNodes(root: THREE.Object3D): SailNodes {
  const nodes: SailNodes = { square: [], aft: [] };
  root.traverse((o) => {
    if (o.name.endsWith('trim-square')) nodes.square.push(o);
    else if (o.name.endsWith('trim-aft')) nodes.aft.push(o);
  });
  return nodes;
}

/** Wind trim and battle damage both scale the sails' height; the product is applied. */
export interface SailTrim {
  /**
   * `windRel` is the signed angle from the bow to the wind's origin (+ = wind from port);
   * `level` is sail deployment 0 (furled) … 1 (full).
   */
  trim(windRel: number, level: number): void;
  /** Damage factor (0.55…1) on the sail height, from `ConditionRig.sailHeight`. */
  setDamageHeight(height: number): void;
}

export function createSailTrim(nodes: SailNodes): SailTrim {
  let side = 1;
  let trimHeight = 1;
  let damage = 1;
  const apply = (): void => {
    const height = trimHeight * damage;
    for (const o of nodes.square) o.scale.set(1, height, 1);
    for (const o of nodes.aft) o.scale.set(1, height, side); // mirrored so the sail always bellies to leeward
  };
  return {
    trim(windRel, level): void {
      side = windRel >= 0 ? 1 : -1;
      // Closer to the wind: yards braced hard round, fore-and-aft sails sheeted in.
      const downwind = smoothstep(0.7, 3.0, Math.abs(windRel));
      const brace = 0.65 * (1 - downwind);
      const sheet = 0.08 + 1.02 * downwind;
      const lv = clamp(level, 0, 1);
      const shown = lv > 0.05;
      trimHeight = 0.35 + 0.65 * lv;
      for (const o of nodes.square) {
        o.visible = shown;
        o.rotation.y = side * brace;
      }
      for (const o of nodes.aft) {
        o.visible = shown;
        o.rotation.y = side * sheet;
      }
      apply();
    },
    setDamageHeight(height): void {
      damage = height;
      apply();
    },
  };
}
