import * as THREE from 'three';
import type { Placement } from './townPlan';
import type { WorldKit } from './worldKit';

/** The same placements drawn at the two levels of detail: `near` with the whole props, `far` with their cheap versions. */
export interface InstancedSet {
  near: THREE.Group;
  far: THREE.Group;
  /** Show one level (or none). */
  show(level: 0 | 1 | null): void;
}

const dummy = new THREE.Object3D();
const color = new THREE.Color();

/** Group the placements by prop and draw each group as one instanced mesh per level. */
export function instancePlacements(kit: WorldKit, placements: readonly Placement[], name: string): InstancedSet | null {
  const byProp = new Map<string, Placement[]>();
  for (const p of placements) {
    if (!kit.has(p.prop)) continue;
    const list = byProp.get(p.prop) ?? [];
    list.push(p);
    byProp.set(p.prop, list);
  }
  if (byProp.size === 0) return null;
  const make = (lod: 0 | 1): THREE.Group => {
    const g = new THREE.Group();
    g.name = `${name}-lod${lod}`;
    for (const [prop, list] of byProp) {
      const geometry = kit.geometry(prop, lod) ?? kit.geometry(prop, 0);
      if (!geometry) continue;
      const mesh = new THREE.InstancedMesh(geometry, kit.material, list.length);
      list.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, color.setScalar(p.tint));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.name = `${name}-${prop}-lod${lod}`;
      mesh.userData.shared = true; // geometry and material belong to the kit
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      g.add(mesh);
    }
    return g;
  };
  const near = make(0);
  const far = make(1);
  return {
    near,
    far,
    show(level): void {
      near.visible = level === 0;
      far.visible = level === 1;
    },
  };
}
