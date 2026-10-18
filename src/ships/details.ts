import * as THREE from 'three';
import type { ShipSpec } from './types';
import type { ShipMaterials } from './materials';
import { deckHeight, halfBeam, sectionPoint, sidePoint } from './hullShape';
import { BULWARK } from './hull';

const dummy = new THREE.Object3D();

/** Gun ports as one instanced mesh, both sides, `gunDecks` rows. */
export function buildGunPorts(spec: ShipSpec, mats: ShipMaterials): THREE.InstancedMesh | null {
  const total = spec.stats.cannons;
  if (total <= 0) return null;
  const rows = Math.max(1, spec.gunDecks);
  const perRow = Math.max(1, Math.round(total / 2 / rows));
  const span = 0.5;
  const spacing = (span * spec.length) / perRow;
  const size = Math.min(0.55, spacing * 0.7, 0.9);
  const rowGap = Math.min(1.3, Math.max(size * 1.3, (spec.freeboard - 1) / rows));

  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size, size * 0.8, 0.12), mats.dark, perRow * rows * 2);
  mesh.name = 'gun-ports';
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let n = 0; n < perRow; n++) {
      const t = 0.22 + span * ((n + 0.5) / perRow);
      const p = sidePoint(spec, t, 0.9 + r * rowGap);
      for (const side of [1, -1]) {
        dummy.position.set(p.x, p.y, side * (p.z + 0.03));
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** Oars slanting from the rail into the water, both sides. */
export function buildOars(spec: ShipSpec, mats: ShipMaterials): THREE.InstancedMesh | null {
  if (spec.oars <= 0) return null;
  const oarLength = spec.length * 0.18;
  const dir = new THREE.Vector3(0.15, -0.55, 0.8).normalize();
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), mats.wood, spec.oars * 2);
  mesh.name = 'oars';
  let i = 0;
  for (let n = 0; n < spec.oars; n++) {
    const t = 0.28 + 0.5 * ((n + 0.5) / spec.oars);
    const rail = sectionPoint(spec, t, 1);
    rail.y = deckHeight(spec, t) - BULWARK / 2;
    for (const side of [1, -1]) {
      const d = new THREE.Vector3(dir.x, dir.y, dir.z * side);
      const start = new THREE.Vector3(rail.x, rail.y, side * halfBeam(spec, t)).addScaledVector(d, -oarLength * 0.25);
      dummy.position.copy(start).addScaledVector(d, oarLength * 0.625);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      dummy.scale.set(1, oarLength * 1.25, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i++, dummy.matrix);
    }
  }
  dummy.quaternion.identity();
  dummy.scale.set(1, 1, 1);
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** Lit stern windows on the sterncastle transom. */
export function buildSternWindows(spec: ShipSpec, mats: ShipMaterials): THREE.InstancedMesh | null {
  const castle = spec.sterncastle;
  if (!castle || castle.height < 1.2) return null;
  const count = Math.min(5, Math.max(2, Math.round(spec.beam / 2.4)));
  const w = Math.min(0.9, castle.height * 0.25);
  const hw = halfBeam(spec, 0);
  const y = deckHeight(spec, 0) - BULWARK + castle.height * 0.55;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, w, w * 0.8), mats.window, count);
  mesh.name = 'stern-windows';
  for (let n = 0; n < count; n++) {
    const z = count === 1 ? 0 : -hw * 0.65 + (hw * 1.3 * n) / (count - 1);
    dummy.position.set(-spec.length / 2 - 0.02, y, z);
    dummy.updateMatrix();
    mesh.setMatrixAt(n, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
