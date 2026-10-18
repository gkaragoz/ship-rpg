import * as THREE from 'three';
import { WORLD_BOUNDS, terrainHeight } from '../world';
import { createSeaMesh, type SeaMesh } from './oceanMesh';
import { bakeSeaNoise } from './seaNoise';
import type { SeaLook } from './seaLook';
import { TERRAIN_TEX, createSeaMaterial, setSeaQuality, setSeaWake, updateSeaMaterial } from './oceanShader';
import type { Wake } from './wake';
import { TEXTURE_QUALITY, type Quality } from './quality';
import type { TextureQuality } from '../settings';

export { FOG_FAR, FOG_NEAR, HORIZON_COLOR, SUN_DIR } from './seaLook';

/** Bake the sea floor / land height into a small texture the sea shader can sample. */
function bakeTerrainTexture(width: number, height: number): THREE.DataTexture {
  const { min, range } = TERRAIN_TEX;
  const data = new Uint8Array(width * height);
  const sx = (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX) / width;
  const sz = (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) / height;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const h = terrainHeight(WORLD_BOUNDS.minX + (i + 0.5) * sx, WORLD_BOUNDS.minZ + (j + 0.5) * sz);
      data[j * width + i] = Math.round(Math.min(Math.max((h - min) / range, 0), 1) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

export interface Ocean {
  object: THREE.Object3D;
  /** Re-centre under the camera and advance the waves. */
  update(camera: THREE.Camera, time: number, windFrom: number, ampScale: number, seaState: number, look: SeaLook): void;
  /** Use this foam and ripple map for the wakes of ships. */
  setWake(wake: Wake, texels: number): void;
  /** Rebuild the sea's detail and depth textures for a texture quality, and set filtering. */
  setTextures(level: TextureQuality, maxAnisotropy: number): void;
  /** Rebuild the sea mesh for another quality preset. */
  setQuality(quality: Quality): void;
  dispose(): void;
}

/** Wave-displaced sea to the horizon (clip-map levels around the camera), with shallows and shore foam around islands. */
export function createOcean(quality: Quality): Ocean {
  let terrain = bakeTerrainTexture(TEXTURE_QUALITY.medium.terrain.width, TEXTURE_QUALITY.medium.terrain.height);
  let noise = bakeSeaNoise(TEXTURE_QUALITY.medium.noise);
  const material = createSeaMaterial(terrain, noise);
  setSeaQuality(material, quality);
  const object = new THREE.Group();
  let mesh: SeaMesh = createSeaMesh(quality, material);
  object.add(mesh.group);

  return {
    object,
    update(camera, time, windFrom, ampScale, seaState, look): void {
      mesh.follow(camera);
      updateSeaMaterial(material, time, windFrom, ampScale, seaState, look);
    },
    setTextures(level, maxAnisotropy): void {
      const q = TEXTURE_QUALITY[level];
      if (noise.image.width !== q.noise) {
        const next = bakeSeaNoise(q.noise);
        noise.dispose();
        noise = next;
        material.uniforms.uNoise!.value = noise;
      }
      if (terrain.image.width !== q.terrain.width) {
        const next = bakeTerrainTexture(q.terrain.width, q.terrain.height);
        terrain.dispose();
        terrain = next;
        material.uniforms.uTerrain!.value = terrain;
      }
      noise.anisotropy = Math.min(q.anisotropy, maxAnisotropy);
      noise.needsUpdate = true;
    },
    setWake(wake, texels): void {
      setSeaWake(material, wake, texels);
    },
    setQuality(next): void {
      setSeaQuality(material, next);
      object.remove(mesh.group);
      mesh.dispose();
      mesh = createSeaMesh(next, material);
      object.add(mesh.group);
    },
    dispose(): void {
      mesh.dispose();
      material.dispose();
      terrain.dispose();
      noise.dispose();
    },
  };
}
