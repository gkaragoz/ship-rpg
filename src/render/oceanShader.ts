import * as THREE from 'three';
import type { Quality } from './quality';
import { WORLD_BOUNDS } from '../world';
import { WAVE_COUNT, chop, waveDirections, waveGlsl } from './waves';
import { fragmentShader } from './oceanFragment';
import { FOG_FAR, FOG_NEAR, HORIZON_COLOR, SUN_DIR, type SeaLook } from './seaLook';

/** Sea-floor depth texture: R8 holding height −25…+5 m over the world bounds. */
export const TERRAIN_TEX = { width: 1024, height: 640, min: -25, range: 30 };

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uChop;
uniform float uFade;
uniform float uCell0;
uniform vec2 uDirs[${WAVE_COUNT}];
varying vec3 vWorld;
varying float vHeight;
varying vec3 vNormal;
varying float vJac;
${waveGlsl()}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 disp;
  oceanWaves(w.xz, distance(w.xz, cameraPosition.xz), disp, vNormal, vJac);
  w.xyz += disp;
  // Coarser clip-map levels sit a little lower, so where two levels overlap the finer one is always the one seen.
  w.y -= 0.04 * log2(length(modelMatrix[0].xyz) / uCell0);
  vWorld = w.xyz;
  vHeight = disp.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** The shared sea material; `terrain` is the baked depth texture (see `bakeTerrainTexture`). */
export function createSeaMaterial(terrain: THREE.Texture, noise: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    depthFunc: THREE.LessEqualDepth, // overlapping clip-map levels draw the same surface: the later, finer one wins
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: 1 },
      uChop: { value: chop(1) },
      uFade: { value: 1 },
      uCell0: { value: 1 },
      uDirs: { value: waveDirections(0).map(([x, z]) => new THREE.Vector2(x, z)) },
      uSea: { value: 0 },
      uSun: { value: SUN_DIR },
      uSunColor: { value: new THREE.Color(1.0, 0.95, 0.8) },
      uDeep: { value: new THREE.Color(0x0e3a55) },
      uShallow: { value: new THREE.Color(0x2f86a0) },
      uHorizon: { value: HORIZON_COLOR.clone() },
      uZenith: { value: new THREE.Color(0x3f7db0) },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
      uTerrain: { value: terrain },
      uNoise: { value: noise },
      uTerrainMin: { value: new THREE.Vector2(WORLD_BOUNDS.minX, WORLD_BOUNDS.minZ) },
      uTerrainSize: { value: new THREE.Vector2(WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX, WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) },
      uTerrainScale: { value: new THREE.Vector2(TERRAIN_TEX.min, TERRAIN_TEX.range) },
    },
  });
}

/** Tell the shader about the mesh resolution (fine meshes keep short waves further out). */
export function setSeaQuality(material: THREE.ShaderMaterial, quality: Quality): void {
  material.uniforms.uFade!.value = quality.grid / 64;
  material.uniforms.uCell0!.value = quality.cell;
}

/** Feed the per-frame state to the sea material. */
export function updateSeaMaterial(
  material: THREE.ShaderMaterial,
  time: number,
  windFrom: number,
  ampScale: number,
  seaState: number,
  look: SeaLook,
): void {
  const u = material.uniforms;
  u.uSea!.value = seaState;
  (u.uDeep!.value as THREE.Color).copy(look.deep);
  (u.uShallow!.value as THREE.Color).copy(look.shallow);
  (u.uHorizon!.value as THREE.Color).copy(look.horizon);
  (u.uZenith!.value as THREE.Color).copy(look.zenith);
  u.uFogNear!.value = look.fogNear;
  u.uFogFar!.value = look.fogFar;
  u.uTime!.value = time;
  material.uniforms.uAmp!.value = ampScale;
  material.uniforms.uChop!.value = chop(ampScale);
  const dirs = material.uniforms.uDirs!.value as THREE.Vector2[];
  waveDirections(windFrom).forEach(([x, z], k) => dirs[k]?.set(x, z));
}
