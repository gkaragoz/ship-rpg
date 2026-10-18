import * as THREE from 'three';
import type { ShipSpec } from './types';
import { createMaterials, disposeMaterials } from './materials';
import { buildHull } from './hull';
import { buildCastles } from './castles';
import { buildGunPorts, buildLanterns, buildOars, buildSternWindows } from './details';
import { buildRig } from './rig';
import { getShipAsset } from './assets';
import { createGlbShip } from './glbShip';
import type { ShipLod } from './lod';
import { applySailTrim, collectSailNodes } from './trim';

export interface Ship {
  readonly spec: ShipSpec;
  /** Origin at the waterline amidships; +x is the bow. */
  readonly root: THREE.Group;
  /**
   * Trim sails for the wind. `windRel` is the signed angle from the bow to the wind's
   * origin (+ = wind from port); `level` is sail deployment 0 (furled) … 1 (full).
   */
  setSailTrim(windRel: number, level: number): void;
  /** Only on ships with level-of-detail variants (the GLB tartane): 0 = full … 2 = silhouette. */
  setLod?(lod: ShipLod): void;
  /** Frees geometries and materials created for this ship. */
  dispose(): void;
}

export function createShip(spec: ShipSpec): Ship {
  // A preloaded Blender model wins; otherwise the procedural ship is built.
  const glb = getShipAsset(spec.id);
  if (glb) return createGlbShip(spec, glb);
  const mats = createMaterials(spec);
  const root = new THREE.Group();
  root.name = spec.id;
  root.add(buildHull(spec, mats), ...buildCastles(spec, mats), buildRig(spec, mats));
  for (const part of [buildGunPorts(spec, mats), buildOars(spec, mats), buildSternWindows(spec, mats), buildLanterns(spec, mats)]) {
    if (part) root.add(part);
  }
  const sails = collectSailNodes(root);

  return {
    spec,
    root,
    setSailTrim: (windRel, level) => applySailTrim(sails, windRel, level),
    dispose(): void {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose(); // instance matrix buffer
      });
      disposeMaterials(mats);
    },
  };
}
