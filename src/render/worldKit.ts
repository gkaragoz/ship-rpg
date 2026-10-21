import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { tracked } from '../core';

/**
 * The Blender world props (`public/models/world/world.glb`, contract in docs/WORLD_ASSETS.md): houses of every nation's
 * style, church, fort, lighthouse, windmill, crane, pier, trees, rocks, small boats and harbour clutter. Each prop comes
 * in two levels, `<Prop>_LOD0` (whole) and `<Prop>_LOD1` (far, under 65 % of the triangles), all sharing one material.
 * Without the file the scenery falls back to its procedural boxes and cones.
 */
export interface WorldKit {
  /** Geometry of a prop at a level (origin on the ground at the prop's centre, +Y up, a building's front toward +X). */
  geometry(prop: string, lod: 0 | 1): THREE.BufferGeometry | undefined;
  /** The one shared material (flat colour atlas). */
  readonly material: THREE.Material;
  has(prop: string): boolean;
}

let kit: WorldKit | null = null;

export const getWorldKit = (): WorldKit | null => kit;

/** Test hook and fallback switch: install or remove a kit. */
export function setWorldKit(next: WorldKit | null): void {
  kit = next;
}

/** Load the world GLB; on any failure the scenery stays procedural. */
export async function loadWorldAssets(base = `${import.meta.env.BASE_URL}models/world/`): Promise<void> {
  try {
    const gltf = await tracked((p) => new GLTFLoader().loadAsync(`${base}world.glb`, p));
    const geometries = new Map<string, THREE.BufferGeometry>();
    let material: THREE.Material | null = null;
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const g = (o.geometry as THREE.BufferGeometry).clone();
      o.updateWorldMatrix(true, false);
      g.applyMatrix4(o.matrixWorld);
      geometries.set(o.name, g);
      material ??= o.material as THREE.Material;
    });
    if (!material || geometries.size === 0) throw new Error('world.glb has no meshes');
    kit = {
      geometry: (prop, lod) => geometries.get(`${prop}_LOD${lod}`),
      material,
      has: (prop) => geometries.has(`${prop}_LOD0`),
    };
  } catch (err) {
    console.warn('world assets not loaded, the scenery stays procedural', err);
  }
}
