import * as THREE from 'three';
import type { ShipSpec } from './types';
import { createMaterials, disposeMaterials } from './materials';
import { buildHull } from './hull';
import { buildCastles } from './castles';
import { buildGunPorts, buildLanterns, buildOars, buildSternFlag, buildSternWindows } from './details';
import { buildRig } from './rig';
import { getShipAsset } from './assets';
import { createConditionRig } from './condition';
import { createGlbShip } from './glbShip';
import type { ShipLod } from './lod';
import { collectSailNodes, createSailTrim } from './trim';
import type { Condition } from '../core';

export interface Ship {
  readonly spec: ShipSpec;
  /** Origin at the waterline amidships; +x is the bow. */
  readonly root: THREE.Group;
  /**
   * Trim sails for the wind. `windRel` is the signed angle from the bow to the wind's
   * origin (+ = wind from port); `level` is sail deployment 0 (furled) … 1 (full).
   */
  setSailTrim(windRel: number, level: number): void;
  /** Only on ships with level-of-detail variants (the GLB ships): 0 = full … 2 = silhouette. */
  setLod?(lod: ShipLod): void;
  /**
   * Show battle damage: sails scorch, shrink and lose upper tiers (rigging), the hull sits low
   * and lists (flooding), flames burn on deck (fire). `time` is game seconds, for flicker.
   * Cheap and idempotent; `{rigging: 1, flooding: 0, fire: 0}` restores the pristine look.
   * Moves an inner pivot, never `root`.
   */
  setCondition(condition: Condition, time: number): void;
  /** Frees geometries and materials created for this ship. */
  dispose(): void;
}

export interface ShipOptions {
  /** Flag cloth colour (pennant and stern ensign); defaults to red. */
  flag?: number;
}

export function createShip(spec: ShipSpec, options: ShipOptions = {}): Ship {
  // A preloaded Blender model wins; otherwise the procedural ship is built.
  const glb = getShipAsset(spec.id);
  if (glb) return createGlbShip(spec, glb, options.flag);
  const mats = createMaterials(spec, options.flag);
  const root = new THREE.Group();
  root.name = spec.id;
  const pivot = new THREE.Group(); // condition (sinking, listing) moves this, not root
  pivot.name = 'pivot';
  root.add(pivot);
  pivot.add(buildHull(spec, mats), ...buildCastles(spec, mats), buildRig(spec, mats), buildSternFlag(spec, mats));
  for (const part of [buildGunPorts(spec, mats), buildOars(spec, mats), buildSternWindows(spec, mats), buildLanterns(spec, mats)]) {
    if (part) pivot.add(part);
  }
  const sails = collectSailNodes(root);

  const sailTrim = createSailTrim(sails);
  const condition = createConditionRig(spec, mats, pivot, () => sailTrim.setDamageHeight(condition.sailHeight()));

  return {
    spec,
    root,
    setSailTrim: (windRel, level) => sailTrim.trim(windRel, level),
    setCondition(c, time): void {
      condition.apply(c, time);
    },
    dispose(): void {
      condition.dispose();
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose(); // instance matrix buffer
      });
      disposeMaterials(mats);
    },
  };
}
