import * as THREE from 'three';
import { clothBakeUniforms } from './clothBake';
import { clothTime, type ClothUniforms } from './clothShader';
import { weldedComponents } from './clothGeometry';

/**
 * Flags on the GPU. The Blender flag mesh holds every pennant and the ensign as separate strips streaming towards −x
 * from their pole, with one flat swatch UV, so the pole-anchored coordinate is derived at load time instead:
 *  - `flagA` = (s, depth, length, seed): metres from the pole along the cloth, metres below the pole's top, the strip's
 *    length, a per-strip seed;
 *  - `flagP` = the pole point (x, y, z) the strip hangs from.
 * The shader rebuilds the position from those: a travelling wave whose amplitude grows towards the tip, a sideways bend
 * ∝ u²·sin(apparent wind angle) (the tip lines up with the wind, the root stays on the pole), droop in light air and a
 * flutter at the tip, all stronger with wind speed and gusts. Normals by finite differences.
 */
const CACHE = 'flagAnalysis';

/** Add the flag attributes to a geometry made of strips streaming towards −x. Returns the strip count. */
export function prepareFlag(geometry: THREE.BufferGeometry, seed = 0): number {
  const cached = geometry.userData[CACHE] as number | undefined;
  if (cached !== undefined) return cached;
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const index = geometry.getIndex();
  if (!pos || !index) return 0;
  const n = pos.count;
  const { label: raw } = weldedComponents(pos, index.array);
  // Labels may skip numbers (vertices nothing refers to); compact them so arrays are sized by the strip count.
  const ids = new Map<number, number>();
  const label = raw.map((l) => ids.get(l) ?? (ids.set(l, ids.size), ids.size - 1));
  const count = ids.size;
  const poleX = new Float64Array(count).fill(-Infinity);
  const tipX = new Float64Array(count).fill(Infinity);
  for (let v = 0; v < n; v++) {
    const c = label[v] as number;
    poleX[c] = Math.max(poleX[c] as number, pos.getX(v));
    tipX[c] = Math.min(tipX[c] as number, pos.getX(v));
  }
  const poleY = new Float64Array(count).fill(-Infinity);
  const poleZ = new Float64Array(count);
  const poleN = new Float64Array(count);
  for (let v = 0; v < n; v++) {
    const c = label[v] as number;
    if (pos.getX(v) < (poleX[c] as number) - 1e-3) continue;
    poleY[c] = Math.max(poleY[c] as number, pos.getY(v));
    poleZ[c] = (poleZ[c] as number) + pos.getZ(v);
    poleN[c] = (poleN[c] as number) + 1;
  }
  const A = new Float32Array(n * 4);
  const P = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const c = label[v] as number;
    const px = poleX[c] as number;
    const py = poleY[c] as number;
    const pz = (poleZ[c] as number) / Math.max(poleN[c] as number, 1);
    A.set([px - pos.getX(v), py - pos.getY(v), px - (tipX[c] as number), (seed + c * 0.37) % 1], v * 4);
    P.set([px, py, pz], v * 3);
  }
  geometry.setAttribute('flagA', new THREE.BufferAttribute(A, 4));
  geometry.setAttribute('flagP', new THREE.BufferAttribute(P, 3));
  geometry.userData[CACHE] = count;
  return count;
}

const HEAD = /* glsl */ `
attribute vec4 flagA;
attribute vec3 flagP;
uniform vec4 uWind;
uniform float uTime;
uniform highp sampler2DArray uBake;
uniform vec4 uBakeInfo;  // x: bake loaded, w: frames per loop

// The baked flag wave (a strip pinned and driven at the pole, free at the tip), -1..1: u along the cloth, v across it.
float bakeWave(float u, float v, float w, float seed) {
  float n = uBakeInfo.w;
  float fr = mod(uTime * 24.0 + seed * n, n);
  float f0 = floor(fr);
  float f1 = mod(f0 + 1.0, n);
  float k = fr - f0;
  float t = clamp((w - 0.35) / 0.5, 0.0, 1.0);   // calm loop to lively loop
  vec2 q = (clamp(vec2(u, v), 0.0, 1.0) * vec2(15.0, 11.0) + 0.5) / vec2(16.0, 12.0);
  float lo = mix(texture(uBake, vec3(q, 193.0 + f0)).x, texture(uBake, vec3(q, 193.0 + f1)).x, k);
  float hi = mix(texture(uBake, vec3(q, 225.0 + f0)).x, texture(uBake, vec3(q, 225.0 + f1)).x, k);
  return mix(lo, hi, t);
}

vec3 flagPos(float s, float depth, float L, float seed) {
  float u = clamp(s / L, 0.0, 1.0);
  float th = uWind.x;
  float speed = uWind.y;
  float w = clamp(speed * uWind.z / 12.0, 0.0, 1.4);
  float stiff = smoothstep(1.0, 7.0, speed * uWind.z);
  float cs = cos(th), sn = sin(th);
  float x = -s * (1.0 + u * (cs - 1.0));
  float z = L * u * u * sn;
  float y = -depth - (1.0 - stiff) * 0.55 * L * u * u;
  x *= 1.0 - 0.18 * (1.0 - stiff) * u * u;
  float k = 11.0 + 5.0 * w;
  float phase = u * k - uTime * (5.0 + 2.2 * speed) + depth * 1.7 + seed * 6.2832;
  float amp = (0.025 + 0.08 * w) * L * u * (0.35 + 0.65 * u);
  float tip = 0.02 * L * smoothstep(0.55, 1.0, u) * (0.4 + w) * sin(u * 37.0 - uTime * (23.0 + 1.5 * speed) + seed * 3.0 + depth * 4.0);
  float wave = amp * sin(phase) + tip;
  if (uBakeInfo.x > 0.5) wave = amp * 1.6 * bakeWave(u, depth / (0.5 * L), w, seed);
  vec2 t = vec2(-(1.0 + 2.0 * u * (cs - 1.0)), 2.0 * u * sn);
  vec2 perp = vec2(t.y, -t.x) / max(length(t), 1e-3);
  return vec3(x + perp.x * wave, y, z + perp.y * wave);
}

void flagDeform(inout vec3 p, inout vec3 n) {
  float s = flagA.x, depth = flagA.y, L = max(flagA.z, 0.05), seed = flagA.w;
  vec3 base = flagPos(s, depth, L, seed);
  vec3 ds = flagPos(s + 0.05 * L, depth, L, seed) - base;
  vec3 dd = flagPos(s, depth + 0.05 * L, L, seed) - base;
  vec3 nn = cross(ds, dd);
  if (length(nn) > 1e-8) {
    nn = normalize(nn);
    n = dot(nn, n) < 0.0 ? -nn : nn;
  }
  p = flagP + base;
}
`;

/** Patch a flag material (standard or basic) with the flag shader and the ship's wind uniform. */
export function patchFlagMaterial(material: THREE.Material, uniforms: ClothUniforms, withNormals: boolean): void {
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.uWind = uniforms.wind;
    shader.uniforms.uTime = clothTime;
    shader.uniforms.uBake = clothBakeUniforms.uBake;
    shader.uniforms.uBakeInfo = clothBakeUniforms.uBakeInfo;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${HEAD}`);
    shader.vertexShader = withNormals
      ? shader.vertexShader
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 flagP2 = position;\nflagDeform(flagP2, objectNormal);')
          .replace('#include <begin_vertex>', 'vec3 transformed = flagP2;')
      : shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position;\nvec3 flagN = normal;\nflagDeform(transformed, flagN);');
  };
  material.customProgramCacheKey = (): string => (withNormals ? 'cloth-flag-lit-2' : 'cloth-flag-2');
  material.needsUpdate = true;
}

/** Depth material for a flag's shadow. */
export function createFlagDepthMaterial(uniforms: ClothUniforms): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  patchFlagMaterial(material, uniforms, false);
  material.customProgramCacheKey = (): string => 'cloth-flag-depth-2';
  return material;
}

/** GLSL source of the flag patch (for tests). */
export const flagShaderSource = HEAD;

/** A flag strip of `cols` × `rows` quads from the pole at the origin streaming towards −x, hanging `width` m (at the pole) down. */
export function flagStrip(length: number, width: number, taper: number, cols = 8, rows = 3): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= cols; i++) {
    const u = i / cols;
    for (let j = 0; j <= rows; j++) positions.push(-length * u, -width * (j / rows) * (1 - taper * u), 0);
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      indices.push(a, a + 1, a + rows + 1, a + 1, a + rows + 2, a + rows + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
