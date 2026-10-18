import * as THREE from 'three';
import { components, prepareSail, type SailAnalysis } from './clothGeometry';
import { prepareAftYards, prepareYards } from './clothYards';
import { createClothDepthMaterial, patchSailMaterial, withDetail, type ClothUniforms } from './clothShader';
import type { ShipMaterials } from './materials';
import type { SailNodes } from './trim';

/**
 * Wiring of the cloth shader to a ship model: which meshes get the cloth attributes, a patched private material and a
 * depth material. Every sail, jib and yards mesh of every level of detail is covered; coarser levels run the same shader
 * without flutter and folds (`ClothUniforms.detail` 0), so furl, belly and tear match across level switches.
 */
export interface ClothRig {
  /** Pivots whose sails the shader moves (they only swing). */
  shaded: Set<THREE.Object3D>;
  /** Most square-sail tiers on one mast. */
  tiers: number;
  /** Jibs on the ship (separate grids of the LOD0 jib mesh; the procedural ship has one mesh each). */
  jibs: number;
  /** Private materials made for this ship (sail cloth, patched yards, plain spars): scorch and dispose them. */
  materials: THREE.MeshStandardMaterial[];
  /** Depth materials made for this ship. */
  depths: THREE.Material[];
  /** Every mesh that got a patched cloth material, with the cloth kind (for tests and debugging). */
  meshes: { mesh: THREE.Mesh; kind: 'sail' | 'jib' | 'yards' | 'aftYards' }[];
}

const meshesOf = (root: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
};

const jibCount = (g: THREE.BufferGeometry): number => {
  const index = g.getIndex();
  return index ? components(index.array, g.getAttribute('position').count).count : 0;
};

const lodOf = (name: string): number => Number(/^LOD(\d)/.exec(name)?.[1] ?? 0);
const isSail = (m: THREE.Mesh): boolean => m.name.endsWith('SquareSail') || m.name.endsWith('AftSail');

/** One material map per kind, so every mesh of a kind in a level shares one private clone. */
function cloner(uniforms: ClothUniforms, out: THREE.MeshStandardMaterial[]) {
  const maps = { sail: new Map<THREE.Material, THREE.MeshStandardMaterial>(), rigging: new Map<THREE.Material, THREE.MeshStandardMaterial>(), plain: new Map<THREE.Material, THREE.MeshStandardMaterial>() };
  return (m: THREE.MeshStandardMaterial, kind: keyof typeof maps): THREE.MeshStandardMaterial => {
    let c = maps[kind].get(m);
    if (!c) {
      c = m.clone();
      maps[kind].set(m, c);
      out.push(c);
      if (kind !== 'plain') patchSailMaterial(c, uniforms);
    }
    return c;
  };
}

/**
 * Cloth for a GLB ship: all `LODn_m<i>_trim-…` pivots (their sails, yards and booms) and every `LODn_Jib`. Pivots whose
 * sail is not the expected grid are left alone and stay scaled by `trim.ts`.
 */
export function clothifyGlb(root: THREE.Object3D, sails: SailNodes, uniforms: ClothUniforms): ClothRig {
  const rig: ClothRig = { shaded: new Set(), tiers: 1, jibs: 0, materials: [], depths: [], meshes: [] };
  const pivots = [...sails.square, ...sails.aft];
  const levels = [0, 1, 2].map((l) => {
    const u = l === 0 ? uniforms : withDetail(uniforms, 0);
    const depth = createClothDepthMaterial(u);
    rig.depths.push(depth);
    return { u, depth, own: cloner(u, rig.materials) };
  });

  const info = pivots.map((pivot) => {
    const all = meshesOf(pivot);
    const sailMeshes = all.filter(isSail);
    const counts = sailMeshes.map((m) => {
      const index = m.geometry.getIndex();
      return index ? (m.name.endsWith('SquareSail') ? components(index.array, m.geometry.getAttribute('position').count).count : 1) : 0;
    });
    return { pivot, all, sailMeshes, counts };
  });
  for (const f of info) if (lodOf(f.pivot.name) === 0) f.sailMeshes.forEach((m, i) => (rig.tiers = Math.max(rig.tiers, m.name.endsWith('SquareSail') ? (f.counts[i] as number) : 1)));

  info.forEach(({ pivot, all, sailMeshes, counts }, i) => {
    if (sailMeshes.length === 0 || counts.some((c) => c === 0)) return;
    const level = levels[Math.min(lodOf(pivot.name), 2)] as (typeof levels)[number];
    const seed = ((i * 0.37) % 1) + 0.05;
    const analyses: SailAnalysis[] = [];
    for (let s = 0; s < sailMeshes.length; s++) {
      const mesh = sailMeshes[s] as THREE.Mesh;
      const square = mesh.name.endsWith('SquareSail');
      const a = prepareSail(mesh.geometry, square ? 'square' : 'aft', seed, square ? Math.max(rig.tiers - (counts[s] as number), 0) : 0);
      if (!a) return;
      analyses.push(a);
    }
    rig.shaded.add(pivot);
    const squareA = analyses.find((a) => a.kind === 'square');
    const aftA = analyses.find((a) => a.kind === 'aft');
    const slotOffset = squareA ? Math.max(rig.tiers - squareA.tiers.length, 0) : 0;
    for (const mesh of all) {
      if (!(mesh.material instanceof THREE.MeshStandardMaterial)) continue;
      if (sailMeshes.includes(mesh)) {
        mesh.material = level.own(mesh.material, 'sail');
        mesh.customDepthMaterial = level.depth;
        rig.meshes.push({ mesh, kind: 'sail' });
      } else if (mesh.name.endsWith('SquareYards') && squareA) {
        prepareYards(mesh.geometry, squareA.tiers, seed, slotOffset);
        mesh.material = level.own(mesh.material, 'rigging');
        mesh.customDepthMaterial = level.depth;
        rig.meshes.push({ mesh, kind: 'yards' });
      } else if (mesh.name.endsWith('AftYards') && aftA) {
        prepareAftYards(mesh.geometry, aftA, seed);
        mesh.material = level.own(mesh.material, 'rigging');
        mesh.customDepthMaterial = level.depth;
        rig.meshes.push({ mesh, kind: 'aftYards' });
      } else {
        mesh.material = level.own(mesh.material, 'plain');
      }
    }
  });

  let jibs = 1;
  for (const mesh of meshesOf(root)) {
    if (!mesh.name.endsWith('Jib') || !(mesh.material instanceof THREE.MeshStandardMaterial)) continue;
    const level = levels[Math.min(lodOf(mesh.name), 2)] as (typeof levels)[number];
    if (!prepareSail(mesh.geometry, 'jib', (jibs++ * 0.31) % 1)) continue;
    mesh.material = level.own(mesh.material, 'sail');
    mesh.customDepthMaterial = level.depth;
    rig.meshes.push({ mesh, kind: 'jib' });
    if (lodOf(mesh.name) === 0) rig.jibs = Math.max(rig.jibs, jibCount(mesh.geometry));
  }
  return rig;
}

/**
 * Cloth for the procedural ship: every mesh that uses the ship's sail material is a gridSail (a square tier in a
 * `sail-tier-<k>` group, a fore-and-aft sail under `trim-aft`, a jib under `bowsprit`); they get the attributes and
 * the ship's sail material is patched once. The yards of the square tiers sit on their head lines and stay; the booms
 * and gaffs under `trim-aft` (cylinders) get their transform baked into the geometry and a patched private wood
 * material, so they follow their sail like the GLB ones.
 */
export function clothifyProcedural(root: THREE.Object3D, mats: ShipMaterials, tiers: number, uniforms: ClothUniforms): ClothRig {
  const rig: ClothRig = { shaded: new Set(), tiers, jibs: 0, materials: [], depths: [], meshes: [] };
  const depth = createClothDepthMaterial(uniforms);
  rig.depths.push(depth);
  let patched = false;
  let i = 0;
  const aftSails = new Map<THREE.Object3D, SailAnalysis>();
  for (const mesh of meshesOf(root)) {
    if (mesh.material !== mats.sail) continue;
    const parent = mesh.parent;
    const seed = ((i++ * 0.37) % 1) + 0.05;
    let ok = false;
    const tier = /^sail-tier-(\d+)$/.exec(parent?.name ?? '');
    if (tier && parent?.parent) {
      const count = parent.parent.children.filter((c) => /^sail-tier-\d+$/.test(c.name)).length;
      ok = prepareSail(mesh.geometry, 'square', seed, Math.max(tiers - count, 0) + Number(tier[1])) !== undefined;
      if (ok) rig.shaded.add(parent.parent);
    } else if (parent?.name === 'trim-aft') {
      const a = prepareSail(mesh.geometry, 'aft', seed);
      ok = a !== undefined;
      if (a) aftSails.set(parent, a);
      if (ok) rig.shaded.add(parent);
    } else if (parent?.name === 'bowsprit') {
      ok = prepareSail(mesh.geometry, 'jib', seed, rig.jibs) !== undefined;
      if (ok) rig.jibs++;
    }
    if (!ok) continue;
    mesh.customDepthMaterial = depth;
    rig.meshes.push({ mesh, kind: parent?.name === 'bowsprit' ? 'jib' : 'sail' });
    if (!patched) {
      patchSailMaterial(mats.sail, uniforms);
      patched = true;
    }
  }
  if (aftSails.size === 0) return rig;
  const wood = (mats.wood as THREE.MeshStandardMaterial).clone();
  patchSailMaterial(wood, uniforms);
  rig.materials.push(wood);
  for (const [pivot, analysis] of aftSails) {
    for (const mesh of pivot.children) {
      if (!(mesh instanceof THREE.Mesh) || mesh.material !== mats.wood) continue;
      mesh.updateMatrix();
      mesh.geometry.applyMatrix4(mesh.matrix); // the shader works on pivot-space positions
      mesh.position.set(0, 0, 0);
      mesh.quaternion.identity();
      mesh.scale.set(1, 1, 1);
      mesh.updateMatrix();
      prepareAftYards(mesh.geometry, analysis, 0.5);
      mesh.material = wood;
      mesh.customDepthMaterial = depth;
      rig.meshes.push({ mesh, kind: 'aftYards' });
    }
  }
  return rig;
}
