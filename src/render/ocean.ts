import * as THREE from 'three';
import { WORLD_BOUNDS, terrainHeight } from '../world';
import { createSeaMesh, type SeaMesh } from './oceanMesh';
import { TERRAIN_TEX, createSeaMaterial, setSeaQuality, updateSeaMaterial } from './oceanShader';
import type { Quality } from './quality';

export { FOG_FAR, FOG_NEAR, HORIZON_COLOR, SUN_DIR } from './seaLook';

/** Bake the sea floor / land height into a small texture the sea shader can sample. */
function bakeTerrainTexture(): THREE.DataTexture {
  const { width, height, min, range } = TERRAIN_TEX;
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
  update(camera: THREE.Camera, time: number, windFrom: number, ampScale: number): void;
  /** Rebuild the sea mesh for another quality preset. */
  setQuality(quality: Quality): void;
  dispose(): void;
}

/** Wave-displaced sea to the horizon (clip-map levels around the camera), with shallows and shore foam around islands. */
export function createOcean(quality: Quality): Ocean {
  const terrain = bakeTerrainTexture();
  const material = createSeaMaterial(terrain);
  setSeaQuality(material, quality);
  const object = new THREE.Group();
  let mesh: SeaMesh = createSeaMesh(quality, material);
  object.add(mesh.group);

  return {
    object,
    update(camera, time, windFrom, ampScale): void {
      mesh.follow(camera);
      updateSeaMaterial(material, time, windFrom, ampScale);
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
    },
  };
}
