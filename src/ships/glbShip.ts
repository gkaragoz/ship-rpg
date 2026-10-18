import * as THREE from 'three';
import type { ShipAsset } from './assets';
import { createRig } from './condition';
import type { Ship } from './factory';
import type { ShipLod } from './lod';
import { DEFAULT_FLAG } from './materials';
import type { ShipSpec } from './types';
import { collectSailNodes, createSailTrim } from './trim';
import { clothifyGlb } from './clothRig';
import { requestClothBake } from './clothBake';
import { createClothUniforms } from './clothShader';
import { ensignTexture, isEnsign } from './flagArt';
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
export function createGlbShip(spec: ShipSpec, asset: ShipAsset, flag: number = DEFAULT_FLAG, ensign?: string): Ship {
  const root = asset.scene.clone(true) as THREE.Group;
  root.name = spec.id;
  const pivot = new THREE.Group(); // condition (sinking, listing) moves this, not root
  pivot.name = 'pivot';
  pivot.add(...root.children);
  root.add(pivot);
  const lods = [0, 1, 2].map((l) => root.getObjectByName(`LOD${l}`));
  const sails = collectSailNodes(root);
  const uniforms = createClothUniforms();
  void requestClothBake(); // the shared flutter field; the analytic flutter shows until it has loaded
  // Every sail, jib, yards and boom mesh of every level is drawn by the cloth shader (they only swing); LOD1 and LOD2 skip flutter and folds.
  const cloth = clothifyGlb(root, sails, uniforms);
  const sailMats = cloth.materials;
  // Pennants and the ensign are their own `LODn_Flag` meshes so each nation's colour can be set per ship, and the flag shader waves them.
  const flagMats = ownMaterials(namedNodes(root, '_Flag'));
  const flagDepth = createFlagDepthMaterial(uniforms);
  for (const m of flagMats) {
    m.color.setHex(flag);
    if (isEnsign(ensign)) {
      m.map = ensignTexture(ensign); // the nation's flag art; the pennants sample its plain strip
      m.color.setHex(0xffffff);
    }
  }
  for (const node of namedNodes(root, '_Flag')) {
    node.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !prepareFlag(o.geometry as THREE.BufferGeometry)) return;
      o.customDepthMaterial = flagDepth;
      if (o.material instanceof THREE.MeshStandardMaterial) patchFlagMaterial(o.material, uniforms, true); // only strips the shader can parametrise
    });
  }

  const sailTrim = createSailTrim(sails, { tiers: cloth.tiers, jibs: cloth.jibs, cloth: uniforms, shaded: cloth.shaded });
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
      for (const m of [...sailMats, ...flagMats, ...cloth.depths, flagDepth]) m.dispose();
      root.removeFromParent();
    },
  };
}
