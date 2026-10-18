import * as THREE from 'three';
import type { ShipSpec } from './types';

export interface ShipMaterials {
  hullLower: THREE.Material;
  hullMain: THREE.Material;
  wale: THREE.Material;
  deck: THREE.Material;
  wood: THREE.Material;
  sail: THREE.Material;
  dark: THREE.Material;
  flag: THREE.Material;
  window: THREE.Material;
}

/** Double-sided so deck, castles and transom stay visible whatever their winding. */
const flat = (color: number): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });

export function createMaterials(spec: ShipSpec): ShipMaterials {
  return {
    hullLower: flat(new THREE.Color(spec.hullColor).multiplyScalar(0.5).getHex()),
    hullMain: flat(spec.hullColor),
    wale: flat(spec.trimColor),
    deck: flat(0xb08a58),
    wood: flat(0x4a3321),
    sail: new THREE.MeshStandardMaterial({
      color: 0xefe6cf,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
    }),
    dark: flat(0x140e08),
    flag: new THREE.MeshBasicMaterial({ color: 0xc0392b, side: THREE.DoubleSide }),
    window: new THREE.MeshBasicMaterial({ color: 0xffd27a }),
  };
}

export function disposeMaterials(mats: ShipMaterials): void {
  for (const m of Object.values(mats)) m.dispose();
}
