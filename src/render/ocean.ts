import * as THREE from 'three';
import { WORLD_BOUNDS, terrainHeight } from '../world';
import { waveGlsl } from './waves';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.5, -0.35).normalize();
export const HORIZON_COLOR = new THREE.Color(0xb7d4e0);
/** Distant islands fade into the haze; the far sea is fully fogged before its own edge. */
export const FOG_NEAR = 250;
export const FOG_FAR = 2400;

/** Fine mesh around the camera (waves, shallows) and a coarse one out to the horizon. */
const NEAR = { size: 900, segments: 360 };
const FAR = { size: 7000, segments: 320, hole: 400 };
const NEAR_CELL = NEAR.size / NEAR.segments;
const FAR_CELL = FAR.size / FAR.segments;

/** Sea-floor depth texture: R8 holding height −25…+5 m over the world bounds. */
const TERRAIN_TEX = { width: 1024, height: 640, min: -25, range: 30 };

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uAmp;
varying vec3 vWorld;
varying float vHeight;
${waveGlsl()}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float lod = 1.0 - smoothstep(150.0, 420.0, distance(w.xz, cameraPosition.xz));
  float h = oceanHeight(w.xz, lod);
  w.y += h;
  vWorld = w.xyz;
  vHeight = h;
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
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.0) n = -n;
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

/** A square sea mesh; the far one has a square hole where the near one sits. */
function seaGeometry(size: number, segments: number, hole = 0): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  if (hole > 0) {
    const pos = geometry.getAttribute('position');
    const index = geometry.getIndex();
    if (index) {
      const kept: number[] = [];
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
        const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
        if (Math.max(Math.abs(cx), Math.abs(cz)) >= hole) kept.push(a, b, c);
      }
      geometry.setIndex(kept);
    }
  }
  return geometry;
}

export interface Ocean {
  object: THREE.Object3D;
  /** Re-centre under the camera and advance the waves. */
  update(camera: THREE.Camera, time: number, windFrom: number, ampScale: number): void;
  dispose(): void;
}

/** Wave-displaced, flat-shaded sea to the horizon, with shallows and shore foam around islands. */
export function createOcean(): Ocean {
  const terrain = bakeTerrainTexture();
  const make = (far: boolean): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      // The coarse mesh must lose the depth fight where the two overlap.
      polygonOffset: far,
      polygonOffsetFactor: far ? 2 : 0,
      polygonOffsetUnits: far ? 2 : 0,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: 0 },
        uAmp: { value: 1 },
        uSun: { value: SUN_DIR },
        uDeep: { value: new THREE.Color(0x0e3a55) },
        uShallow: { value: new THREE.Color(0x2f86a0) },
        uSky: { value: HORIZON_COLOR },
        uFogNear: { value: FOG_NEAR },
        uFogFar: { value: FOG_FAR },
        uTerrain: { value: terrain },
        uTerrainMin: { value: new THREE.Vector2(WORLD_BOUNDS.minX, WORLD_BOUNDS.minZ) },
        uTerrainSize: {
          value: new THREE.Vector2(WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX, WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ),
        },
        uTerrainScale: { value: new THREE.Vector2(TERRAIN_TEX.min, TERRAIN_TEX.range) },
      },
    });

  const nearMaterial = make(false);
  const farMaterial = make(true);
  const near = new THREE.Mesh(seaGeometry(NEAR.size, NEAR.segments), nearMaterial);
  const far = new THREE.Mesh(seaGeometry(FAR.size, FAR.segments, FAR.hole), farMaterial);
  for (const m of [near, far]) m.frustumCulled = false; // vertices are displaced in the shader
  const object = new THREE.Group();
  object.add(far, near);

  return {
    object,
    update(camera, time, windFrom, ampScale): void {
      // Snap to each mesh's own vertex grid so it never visibly slides against the waves.
      near.position.set(
        Math.round(camera.position.x / NEAR_CELL) * NEAR_CELL,
        0,
        Math.round(camera.position.z / NEAR_CELL) * NEAR_CELL,
      );
      far.position.set(
        Math.round(camera.position.x / FAR_CELL) * FAR_CELL,
        0,
        Math.round(camera.position.z / FAR_CELL) * FAR_CELL,
      );
      for (const material of [nearMaterial, farMaterial]) {
        material.uniforms.uTime!.value = time;
        material.uniforms.uWind!.value = windFrom;
        material.uniforms.uAmp!.value = ampScale;
      }
    },
    dispose(): void {
      near.geometry.dispose();
      far.geometry.dispose();
      nearMaterial.dispose();
      farMaterial.dispose();
      terrain.dispose();
    },
  };
}
