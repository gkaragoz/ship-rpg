import * as THREE from 'three';
import type { ShipAsset } from './assets';
import { createRig } from './condition';
import type { Ship } from './factory';
import type { ShipLod } from './lod';
import { DEFAULT_FLAG } from './materials';
import type { ShipSpec } from './types';
import { collectSailNodes, createSailTrim } from './trim';
import { components, prepareSail, prepareYards } from './clothGeometry';
import { createClothDepthMaterial, createClothUniforms, patchSailMaterial, type ClothUniforms } from './clothShader';
import { createFlagDepthMaterial, patchFlagMaterial, prepareFlag } from './flagCloth';

/** Sail colour multiplier at rigging 0 (the atlas colour times this): the scorched sail of `condition.ts`. */
const SCORCHED = new THREE.Color(0.32, 0.27, 0.24);

/**
 * Each ship needs its own sail materials to scorch them (and flag materials to tint them): the asset's are
 * shared by every ship built from it. Clones keep the atlas texture; returns them so they can be disposed.
 */
function ownMaterials(nodes: THREE.Object3D[]): THREE.MeshStandardMaterial[] {
  const clones = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  for (const node of nodes) {
    node.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
      let own = clones.get(o.material);
      if (!own) {
        own = o.material.clone();
        clones.set(o.material, own);
      }
      o.material = own;
    });
  }
  return [...clones.values()];
}

interface ClothMaterials {
  sail: THREE.MeshStandardMaterial[];
  rigging: THREE.MeshStandardMaterial[];
  plain: THREE.MeshStandardMaterial[];
}

const meshesOf = (pivot: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  pivot.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
};

/**
 * Give the full-quality (LOD0) sail pivots the cloth shader: the sail meshes get the cloth attributes and a patched
 * private sail material, the square yards mesh (yards, footropes, boltropes) a patched private wood material so it
 * gathers with its tier, and both a depth material for the shadow. Returns the pivots drawn by the shader, the ship's
 * tier count and the materials. A sail that is not the expected grid keeps its material (and its pivot is scaled).
 */
function clothSails(
  pivots: THREE.Object3D[],
  uniforms: ClothUniforms,
  depth: THREE.Material,
): { shaded: Set<THREE.Object3D>; tiers: number; mats: ClothMaterials } {
  const mats: ClothMaterials = { sail: [], rigging: [], plain: [] };
  const maps = { sail: new Map<THREE.Material, THREE.MeshStandardMaterial>(), rigging: new Map<THREE.Material, THREE.MeshStandardMaterial>(), plain: new Map<THREE.Material, THREE.MeshStandardMaterial>() };
  const own = (m: THREE.MeshStandardMaterial, kind: keyof ClothMaterials): THREE.MeshStandardMaterial => {
    let c = maps[kind].get(m);
    if (!c) {
      c = m.clone();
      maps[kind].set(m, c);
      mats[kind].push(c);
      if (kind !== 'plain') patchSailMaterial(c, uniforms);
    }
    return c;
  };
  const found = pivots.map((pivot) => {
    const all = meshesOf(pivot);
    const sail = all.find((m) => m.name.endsWith('SquareSail') || m.name.endsWith('AftSail'));
    const square = sail?.name.endsWith('SquareSail') ?? false;
    const index = sail?.geometry.getIndex();
    const count = sail && index ? (square ? components(index.array, sail.geometry.getAttribute('position').count).count : 1) : 0;
    return { pivot, all, sail, square, count };
  });
  const tiers = Math.max(1, ...found.filter((f) => f.square).map((f) => f.count));
  const shaded = new Set<THREE.Object3D>();
  found.forEach(({ pivot, all, sail, square, count }, i) => {
    if (!sail || count === 0) return;
    const seed = ((i * 0.37) % 1) + 0.05;
    const analysis = prepareSail(sail.geometry, square ? 'square' : 'aft', seed, square ? tiers - count : 0);
    if (!analysis) return;
    shaded.add(pivot);
    for (const mesh of all) {
      if (!(mesh.material instanceof THREE.MeshStandardMaterial)) continue;
      if (mesh === sail) {
        mesh.material = own(mesh.material, 'sail');
        mesh.customDepthMaterial = depth;
      } else if (square && mesh.name.endsWith('SquareYards')) {
        prepareYards(mesh.geometry, analysis.tiers, seed, tiers - count);
        mesh.material = own(mesh.material, 'rigging');
        mesh.customDepthMaterial = depth;
      } else {
        mesh.material = own(mesh.material, 'plain');
      }
    }
  });
  return { shaded, tiers, mats };
}

/** Nodes whose name ends with `suffix` (`LODn_Flag` pennants and ensign, `LODn_Jib` the static headsails). */
function namedNodes(root: THREE.Object3D, suffix: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name.endsWith(suffix)) out.push(o);
  });
  return out;
}

/**
 * A `Ship` backed by a Blender GLB: `LOD0`..`LOD2` child groups, sails on `LODn_m<i>_trim-…` pivots.
 * Battle damage works as on the procedural ship (see `condition.ts`) except that GLB sails have no
 * separate tiers: damage darkens them and tears their lower part up (more gathering, more flutter).
 * LOD0 sails and flags are moved by the cloth vertex shaders (`clothShader.ts`, `flagCloth.ts`).
 */
export function createGlbShip(spec: ShipSpec, asset: ShipAsset, flag: number = DEFAULT_FLAG): Ship {
  const root = asset.scene.clone(true) as THREE.Group;
  root.name = spec.id;
  const pivot = new THREE.Group(); // condition (sinking, listing) moves this, not root
  pivot.name = 'pivot';
  pivot.add(...root.children);
  root.add(pivot);
  const lods = [0, 1, 2].map((l) => root.getObjectByName(`LOD${l}`));
  const sails = collectSailNodes(root);
  const uniforms = createClothUniforms();
  const depth = createClothDepthMaterial(uniforms);
  // LOD0 sails are drawn by the cloth shader (they only swing); the coarser levels and the jibs are plain materials.
  const lod0 = [...sails.square, ...sails.aft].filter((n) => n.name.startsWith('LOD0_'));
  const lodRest = [...sails.square, ...sails.aft].filter((n) => !n.name.startsWith('LOD0_'));
  const cloth = clothSails(lod0, uniforms, depth);
  const sailMats = [
    ...cloth.mats.sail, ...cloth.mats.rigging, ...cloth.mats.plain,
    ...ownMaterials([...lodRest]), ...ownMaterials(namedNodes(root, '_Jib')),
  ];
  // Pennants and the ensign are their own `LODn_Flag` meshes so each nation's colour can be set per ship, and the flag shader waves them.
  const flagMats = ownMaterials(namedNodes(root, '_Flag'));
  const flagDepth = createFlagDepthMaterial(uniforms);
  for (const m of flagMats) m.color.setHex(flag);
  for (const node of namedNodes(root, '_Flag')) {
    node.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !prepareFlag(o.geometry as THREE.BufferGeometry)) return;
      o.customDepthMaterial = flagDepth;
      if (o.material instanceof THREE.MeshStandardMaterial) patchFlagMaterial(o.material, uniforms, true); // only strips the shader can parametrise
    });
  }

  const sailTrim = createSailTrim(sails, { tiers: cloth.tiers, cloth: uniforms, shaded: cloth.shaded });
  const condition = createRig(spec, pivot, () => sailTrim.setDamageHeight(condition.sailHeight()), (rigging) => {
    for (const m of sailMats) m.color.setRGB(1, 1, 1).lerp(SCORCHED, 1 - rigging);
  });

  const setLod = (lod: ShipLod): void => {
    lods.forEach((node, i) => {
      if (node) node.visible = i === lod;
    });
  };
  setLod(0);

  return {
    spec,
    root,
    setSailTrim: (windRel, level) => sailTrim.trim(windRel, level),
    setWind: (wind) => sailTrim.setWind(wind),
    setCondition: (c, time) => condition.apply(c, time),
    setLod,
    dispose(): void {
      // Geometry, textures and the other materials belong to the shared asset, so only detach.
      condition.dispose();
      for (const m of [...sailMats, ...flagMats, depth, flagDepth]) m.dispose();
      root.removeFromParent();
    },
  };
}
