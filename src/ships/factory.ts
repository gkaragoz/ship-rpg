import * as THREE from 'three';
import type { ShipSpec } from './types';
import { createMaterials, disposeMaterials } from './materials';
import { buildHull } from './hull';
import { buildCastles } from './castles';
import { buildGunPorts, buildLanterns, buildOars, buildSternFlag, buildSternWindows } from './details';
import { buildRig } from './rig';
import { GLB_SHIP_IDS, getShipAsset, requestShipAsset } from './assets';
import { createConditionRig } from './condition';
import { createGlbShip } from './glbShip';
import { createUpgradingShip } from './lazyShip';
import type { ShipLod } from './lod';
import { collectSailNodes, createSailTrim } from './trim';
import { createClothUniforms } from './clothShader';
import { clothifyProcedural } from './clothRig';
import { requestClothBake } from './clothBake';
import { patchFlagMaterial } from './flagCloth';
import type { WindInput } from './clothState';
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
  /**
   * Apparent wind at the ship for the cloth (belly, flutter, flag direction): `angle` from the bow (+ = from port),
   * `speed` m/s, `gust` multiplier 0.75…1.25. Optional: without it the cloth derives a steady 8 m/s wind from `windRel`.
   */
  setWind?(wind: WindInput): void;
  /** Only on ships with level-of-detail variants (the GLB ships, and ships that will become one): 0 = full … 2 = silhouette. */
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

/**
 * Build a ship. A loaded Blender model is used at once; a ship that has one but whose GLB is not loaded yet starts as
 * the procedural ship and is swapped for the model when it arrives (see `createUpgradingShip`), so the game never
 * waits for a model and only the ships that are actually shown are fetched.
 */
export function createShip(spec: ShipSpec, options: ShipOptions = {}): Ship {
  const glb = getShipAsset(spec.id);
  if (glb) return createGlbShip(spec, glb, options.flag);
  const procedural = createProceduralShip(spec, options);
  if (!GLB_SHIP_IDS.includes(spec.id)) return procedural;
  return createUpgradingShip(procedural, async () => {
    const asset = await requestShipAsset(spec.id);
    return asset ? createGlbShip(spec, asset, options.flag) : undefined;
  });
}

export function createProceduralShip(spec: ShipSpec, options: ShipOptions = {}): Ship {
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

  // The sails, jibs and flags are moved by the same cloth shaders as the GLB ships (`clothRig.ts`).
  const cloth = createClothUniforms();
  void requestClothBake();
  patchFlagMaterial(mats.flag, cloth, false);
  const tiers = Math.max(1, ...spec.masts.map((m) => m.tiers ?? 2));
  const clothRig = clothifyProcedural(root, mats, tiers, cloth);
  const sailTrim = createSailTrim(sails, { tiers, jibs: clothRig.jibs, cloth, shaded: clothRig.shaded });
  const condition = createConditionRig(spec, mats, pivot, () => sailTrim.setDamageHeight(condition.sailHeight()));

  return {
    spec,
    root,
    setSailTrim: (windRel, level) => sailTrim.trim(windRel, level),
    setWind: (wind) => sailTrim.setWind(wind),
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
      for (const d of clothRig.depths) d.dispose();
      for (const m of clothRig.materials) m.dispose();
    },
  };
}
