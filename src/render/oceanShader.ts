import * as THREE from 'three';
import { WORLD_BOUNDS } from '../world';
import { WAVE_COUNT, chop, waveDirections, waveGlsl } from './waves';
import { FOG_FAR, FOG_NEAR, HORIZON_COLOR, SUN_DIR } from './seaLook';

/** Sea-floor depth texture: R8 holding height −25…+5 m over the world bounds. */
export const TERRAIN_TEX = { width: 1024, height: 640, min: -25, range: 30 };

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uChop;
uniform vec2 uDirs[${WAVE_COUNT}];
varying vec3 vWorld;
varying float vHeight;
varying vec3 vNormal;
varying float vJac;
${waveGlsl()}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float lod = 1.0 - smoothstep(80.0, 260.0, distance(w.xz, cameraPosition.xz));
  vec3 disp;
  oceanWaves(w.xz, lod, disp, vNormal, vJac);
  w.xyz += disp;
  vWorld = w.xyz;
  vHeight = disp.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform sampler2D uTerrain;
uniform vec2 uTerrainMin;
uniform vec2 uTerrainSize;
uniform vec2 uTerrainScale;
varying vec3 vWorld;
varying float vHeight;
varying vec3 vNormal;
varying float vJac;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float diff = clamp(dot(n, uSun), 0.0, 1.0);
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
  vec3 col = mix(uDeep, uShallow, clamp(0.5 + vHeight * 0.9, 0.0, 1.0));
  col *= 0.55 + 0.6 * diff;

  // Water depth from the baked terrain texture: lagoon tint in the shallows, foam at the shore.
  vec2 uv = (vWorld.xz - uTerrainMin) / uTerrainSize;
  float ground = texture2D(uTerrain, uv).r * uTerrainScale.y + uTerrainScale.x;
  float depth = max(-ground, 0.0);
  float shallow = 1.0 - smoothstep(0.0, 10.0, depth);
  col = mix(col, vec3(0.30, 0.80, 0.74) * (0.7 + 0.5 * diff), shallow * 0.75);
  float foam = (1.0 - smoothstep(0.2, 1.6, depth)) * (0.55 + 0.45 * sin(vWorld.x * 0.8 + vWorld.z * 0.6 + uTime * 1.6 + vHeight * 3.0));
  col = mix(col, vec3(0.95, 0.98, 1.0), clamp(foam, 0.0, 1.0) * 0.85);

  col = mix(col, uSky, fres * 0.55);
  float spec = pow(clamp(dot(reflect(-uSun, n), v), 0.0, 1.0), 60.0);
  col += vec3(1.0, 0.95, 0.8) * spec * 0.6;
  col = mix(col, uSky, smoothstep(uFogNear, uFogFar, distance(cameraPosition, vWorld)));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** The shared sea material; `terrain` is the baked depth texture (see `bakeTerrainTexture`). */
export function createSeaMaterial(terrain: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    depthFunc: THREE.LessEqualDepth, // overlapping clip-map levels draw the same surface: the later, finer one wins
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: 1 },
      uChop: { value: chop(1) },
      uDirs: { value: waveDirections(0).map(([x, z]) => new THREE.Vector2(x, z)) },
      uSun: { value: SUN_DIR },
      uDeep: { value: new THREE.Color(0x0e3a55) },
      uShallow: { value: new THREE.Color(0x2f86a0) },
      uSky: { value: HORIZON_COLOR },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
      uTerrain: { value: terrain },
      uTerrainMin: { value: new THREE.Vector2(WORLD_BOUNDS.minX, WORLD_BOUNDS.minZ) },
      uTerrainSize: { value: new THREE.Vector2(WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX, WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) },
      uTerrainScale: { value: new THREE.Vector2(TERRAIN_TEX.min, TERRAIN_TEX.range) },
    },
  });
}

/** Feed the per-frame state to the sea material. */
export function updateSeaMaterial(material: THREE.ShaderMaterial, time: number, windFrom: number, ampScale: number): void {
  material.uniforms.uTime!.value = time;
  material.uniforms.uAmp!.value = ampScale;
  material.uniforms.uChop!.value = chop(ampScale);
  const dirs = material.uniforms.uDirs!.value as THREE.Vector2[];
  waveDirections(windFrom).forEach(([x, z], k) => dirs[k]?.set(x, z));
}
