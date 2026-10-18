import * as THREE from 'three';
import type { ShipSpec } from './types';
import { createMaterials, disposeMaterials } from './materials';
import { buildHull } from './hull';
import { buildCastles } from './castles';
import { buildGunPorts, buildOars, buildSternWindows } from './details';
import { buildRig } from './rig';

export interface Ship {
  readonly spec: ShipSpec;
  /** Origin at the waterline amidships; +x is the bow. */
  readonly root: THREE.Group;
  /** Frees geometries and materials created for this ship. */
  dispose(): void;
}

export function createShip(spec: ShipSpec): Ship {
  const mats = createMaterials(spec);
  const root = new THREE.Group();
  root.name = spec.id;
  root.add(buildHull(spec, mats), ...buildCastles(spec, mats), buildRig(spec, mats));
  for (const part of [buildGunPorts(spec, mats), buildOars(spec, mats), buildSternWindows(spec, mats)]) {
    if (part) root.add(part);
  }
  return {
    spec,
    root,
    dispose(): void {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose(); // instance matrix buffer
      });
      disposeMaterials(mats);
    },
  };
}
