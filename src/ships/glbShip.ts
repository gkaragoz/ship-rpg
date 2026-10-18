import * as THREE from 'three';
import type { ShipAsset } from './assets';
import type { Ship } from './factory';
import type { ShipLod } from './lod';
import type { ShipSpec } from './types';
import { applySailTrim, collectSailNodes } from './trim';

/** A `Ship` backed by a Blender GLB: `LOD0`..`LOD2` child groups, sails on `LODn_trim-aft` pivots. */
export function createGlbShip(spec: ShipSpec, asset: ShipAsset): Ship {
  const root = asset.scene.clone(true);
  root.name = spec.id;
  const lods = [0, 1, 2].map((l) => root.getObjectByName(`LOD${l}`));
  const sails = collectSailNodes(root);

  const setLod = (lod: ShipLod): void => {
    lods.forEach((node, i) => {
      if (node) node.visible = i === lod;
    });
  };
  setLod(0);

  return {
    spec,
    root: root as THREE.Group,
    setSailTrim: (windRel, level) => applySailTrim(sails, windRel, level),
    setLod,
    dispose(): void {
      // Geometry and materials belong to the shared asset, so only detach.
      root.removeFromParent();
    },
  };
}
