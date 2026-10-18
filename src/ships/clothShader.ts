import * as THREE from 'three';
import { clothBakeUniforms } from './clothBake';

/**
 * Sail cloth on the GPU: a vertex-shader patch for the ship's cloned sail, jib and yards materials, plus a matching
 * depth material so shadows follow the cloth. The CPU only feeds a few smoothed numbers per ship (`ClothUniforms`,
 * see `clothState.ts`); the mesh attributes come from `clothGeometry.ts`; the flutter is the shared baked field of
 * `clothBake.ts` (analytic until it has loaded).
 *
 * - **furl**: each tier gathers up towards its own yard (ruched: baked folds, thicker as it bunches, the corners
 *   rise first) while the yards stay put, so tiers never overlap and nothing sinks into the shrouds; fore-and-aft
 *   sails gather to their head and shrink their corners towards it, their booms follow; jibs are hauled down their stay;
 * - **belly**: the baked billow is scaled by a signed amount, so a sail fills, empties and fills on the other side
 *   smoothly (square sails never push back through the mast plane);
 * - **flutter**: the baked loop, strongest near the irons, in gusts and where the sail is torn;
 * - edges stay pinned; normals are the baked ones tilted by the slopes of the displacement.
 *
 * Every ship's materials share one GL program per kind (`customProgramCacheKey`); only the uniform values differ.
 */
export interface ClothUniforms {
  /** Furl of tier slots 0…2 (bottom up) and of the fore-and-aft sails and jibs: 0 open … 1 gathered. */
  furl: THREE.IUniform<THREE.Vector4>;
  /** Belly of the square sails (0…1) and the fore-and-aft sails and jibs (−1…1). */
  belly: THREE.IUniform<THREE.Vector2>;
  /** Flutter (0…1.2) of the square and the fore-and-aft sails. */
  flutter: THREE.IUniform<THREE.Vector2>;
  /** Furl and belly (−1…1) of each of up to three jibs, which move independently. */
  jibFurl: THREE.IUniform<THREE.Vector4>;
  jibBelly: THREE.IUniform<THREE.Vector4>;
  /** Damage: the lower part of every tier is torn up (0…1). */
  tear: THREE.IUniform<number>;
  /** Apparent wind for the flags: (angle from the bow, speed m/s, gust, 0). */
  wind: THREE.IUniform<THREE.Vector4>;
  /** Amount of flutter and folds: 1 at LOD0, 0 at the coarser levels (they only furl, belly and tear). */
  detail: THREE.IUniform<number>;
}

/** Shared by every cloth material: seconds, wrapped to keep float precision (see `tickClothTime`). */
export const clothTime: THREE.IUniform<number> = { value: 0 };

export function tickClothTime(seconds: number): void {
  clothTime.value = seconds % 3600;
}

export function createClothUniforms(): ClothUniforms {
  return {
    furl: { value: new THREE.Vector4(0, 0, 0, 0) }, // not Vector4() (w = 1 would furl the fore-and-aft sails)
    belly: { value: new THREE.Vector2(0.9, 0.9) }, // a ship nobody trims (the gallery) shows filled sails
    flutter: { value: new THREE.Vector2() },
    jibFurl: { value: new THREE.Vector4(0, 0, 0, 0) },
    jibBelly: { value: new THREE.Vector4(0.9, 0.9, 0.9, 0) },
    tear: { value: 0 },
    wind: { value: new THREE.Vector4(0, 8, 1, 0) },
    detail: { value: 1 },
  };
}

/** The same uniforms (furl, belly, … are shared objects) with another `detail`, for the coarser levels of one ship. */
export function withDetail(base: ClothUniforms, detail: number): ClothUniforms {
  return { ...base, detail: { value: detail } };
}

export const SAIL_PROGRAM_KEY = 'cloth-sail-2';

/** Hand the ship's uniforms (and the shared time and bake) to a compiling cloth shader. */
export function assignClothUniforms(target: Record<string, THREE.IUniform>, u: ClothUniforms): void {
  target.uFurl = u.furl;
  target.uBelly = u.belly;
  target.uFlutter = u.flutter;
  target.uTear = u.tear;
  target.uJibFurl = u.jibFurl;
  target.uJibBelly = u.jibBelly;
  target.uDetail = u.detail;
  target.uTime = clothTime;
  target.uBake = clothBakeUniforms.uBake;
  target.uBakeInfo = clothBakeUniforms.uBakeInfo;
}

const HEAD = /* glsl */ `
attribute vec4 clothA;   // code (1-3 square tier slot, 4 fore-and-aft, 5 jib, +10 rigging), v foot-head, u across, baked belly (m)
attribute vec4 clothB;   // head line y, height, width, seed   (jib: tack x, tack y, size, seed)
attribute vec4 clothC;   // fore-and-aft: head anchor x, y, tallest height, 1 - tip weight   (default 0,0,0,1)
uniform vec4 uFurl;
uniform vec2 uBelly;
uniform vec2 uFlutter;
uniform vec4 uJibFurl;
uniform vec4 uJibBelly;
uniform float uTear;
uniform float uTime;
uniform float uDetail;
uniform highp sampler2DArray uBake;
uniform vec4 uBakeInfo;  // x: bake loaded, y, z: decode scale and offset, w: frames per loop

vec3 bakeAt(float layer, vec2 uv) {
  vec2 q = (clamp(uv, 0.0, 1.0) * vec2(15.0, 11.0) + 0.5) / vec2(16.0, 12.0);
  return texture(uBake, vec3(q, layer)).xyz * uBakeInfo.y + uBakeInfo.z;
}

// Baked flutter at (u, v): dimensionless (z, dz/dx, dz/dy) over a sheet of unit area. Two amplitude levels blended
// by the flutter amount, two frames blended by the fractional frame.
vec3 bakeFlutter(float band, float flutter, float phase, vec2 uv) {
  float n = uBakeInfo.w;
  float fr = mod(phase, n);
  float f0 = floor(fr);
  float f1 = mod(f0 + 1.0, n);
  float w = fr - f0;
  float t = clamp((flutter - 0.4) / 0.6, 0.0, 1.0);
  float a0 = clamp(flutter / 0.4, 0.0, 1.0) * (1.0 - t);
  float base = band * 2.0 * n;
  return a0 * mix(bakeAt(base + f0, uv), bakeAt(base + f1, uv), w) + t * mix(bakeAt(base + n + f0, uv), bakeAt(base + n + f1, uv), w);
}

// The analytic flutter used until the bake has loaded: the same dimensionless quantity.
float analyticZ(float u, float v, float flutter, float seed, float s, float H) {
  float edge = sin(3.14159 * clamp(u, 0.0, 1.0)) * sin(3.14159 * clamp(v, 0.0, 1.0));
  float w = 0.6 * sin(u * 9.0 + v * 5.0 - uTime * 11.0 + seed * 6.2832) + 0.4 * sin(u * 17.0 + v * 11.0 + uTime * 19.0 + seed * 3.1);
  w *= 0.5 + 0.5 * sin(uTime * 2.3 + seed * 4.0);
  return flutter * 0.03 * clamp(H, 2.0, 9.0) / s * edge * w;
}

vec3 flutterField(float u, float v, float aspect, float flutter, float seed, float W, float H) {
  float s = sqrt(W * H);
  float band = aspect > 1.3 ? 0.0 : (aspect < 0.75 ? 2.0 : 1.0);
  vec3 baked = bakeFlutter(band, flutter, uTime * 24.0 + seed * uBakeInfo.w, vec2(u, v));
  float z = analyticZ(u, v, flutter, seed, s, H);
  float eu = 0.04;
  vec3 analytic = vec3(z, (analyticZ(u + eu, v, flutter, seed, s, H) - z) / (eu * W / s), (analyticZ(u, v + eu, flutter, seed, s, H) - z) / (eu * H / s));
  return mix(analytic, baked, step(0.5, uBakeInfo.x));   // the analytic flutter until the bake has loaded
}

// Static ruching folds: (0..1, d/du, d/dv) per unit of the normalised sheet.
vec3 foldField(float u, float v) {
  float f = 0.5 + 0.5 * sin(v * 12.0 + u * 2.0);
  vec3 analytic = vec3(f, cos(v * 12.0 + u * 2.0), 6.0 * cos(v * 12.0 + u * 2.0));
  return mix(analytic, bakeAt(192.0, vec2(u, v)), step(0.5, uBakeInfo.x));
}

// Jib: hauled down towards its tack (the sail slides down the stay), belly to leeward, flutter.
void jibDeform(inout vec3 p, inout vec3 n) {
  vec2 tack = clothB.xy;
  float L = max(clothB.z, 0.3);
  float seed = clothB.w;
  float jib = clothA.x - 5.0;                     // which jib: 0, 1, 2
  float g = clamp((jib < 0.5 ? uJibFurl.x : jib < 1.5 ? uJibFurl.y : uJibFurl.z) * 0.93, 0.0, 0.96);
  float k = (jib < 0.5 ? uJibBelly.x : jib < 1.5 ? uJibBelly.y : uJibBelly.z) * (1.0 - g);
  float baked = clothA.w;
  p.xy = tack + (p.xy - tack) * (1.0 - g);
  vec3 fl = flutterField(clothA.z, clothA.y, 1.0, uFlutter.y, seed + 0.27 * jib, L, L) * uDetail;
  // each jib stands a few cm off the one before it, so overlapping jibs never share a plane (no z-fighting in irons)
  p.z += (k - 1.0) * baked + L * fl.x * (1.0 - g) + 0.06 * jib * (1.0 - clothA.y);
  n = normalize(vec3(n.xy * k, n.z));
}

void clothDeform(inout vec3 p, inout vec3 n) {
  float code = clothA.x;
  if (code < 0.5) return;
  float rigid = step(10.0, code);
  float slot = mod(code, 10.0);
  if (slot > 4.5) {
    jibDeform(p, n);
    return;
  }
  bool aft = slot > 3.5;
  float furl = slot < 1.5 ? uFurl.x : slot < 2.5 ? uFurl.y : slot < 3.5 ? uFurl.z : uFurl.w;
  float belly = aft ? uBelly.y : uBelly.x;
  float flutter = aft ? uFlutter.y : uFlutter.x;
  float yTop = clothB.x;
  float H = max(clothB.y, 0.05);
  float W = max(clothB.z, 0.05);
  float seed = clothB.w;
  float u = clothA.z;
  float d = max(yTop - p.y, 0.0);
  float above = yTop - p.y;                       // negative on the yard, its lifts and the like: they stay
  float g = clamp(furl * 0.93 * (1.0 + 0.22 * abs(2.0 * u - 1.0)), 0.0, 0.96);
  float dn = d / H;
  float tear = uTear * 0.35 * smoothstep(0.1, 1.0, 1.0 - clothA.y);
  float keep = (1.0 - g) * (1.0 - tear);
  float margin = rigid > 0.5 ? min(0.25, 0.08 * H) : 0.0;
  float d2 = d <= margin ? d : margin + (d - margin) * keep;
  float dy = above > 0.0 ? d - d2 : 0.0;
  vec2 p0 = p.xy;
  p.y += dy;
  // corners of a fore-and-aft sail (tack, clew, peak) have no height of their own: they shrink towards the head
  float tip = (aft && rigid < 0.5) ? 1.0 - clothC.w : 0.0;
  if (tip > 0.0) {
    vec2 shrunk = clothC.xy + (p0 - clothC.xy) * (1.0 - 0.93 * g);
    p.xy = mix(p.xy, shrunk, tip);
  }
  if (rigid > 0.5) return;

  float baked = clothA.w;
  float k = belly * (1.0 - g);
  float v = clamp(1.0 - dn, 0.0, 1.0);
  float aspect = (aft ? max(clothC.z, H) : H) / W;
  float s = sqrt(W * H);
  vec3 fl = flutterField(u, v, aspect, flutter, seed, W, H) * (uDetail * (1.0 - g));
  float foldAmp = 0.08 * H * g * smoothstep(0.05, 0.3, g) * uDetail;
  vec3 fo = foldField(u, v);
  float wob = s * fl.x + foldAmp * fo.x;
  if (!aft) wob = max(wob, -k * baked);           // square sails never go behind the mast plane
  float da = (k - 1.0) * baked + wob;
  // Normal: the baked one tilted by the slopes of the displaced surface (axis offset over the two in-plane directions).
  float sh = fl.y + foldAmp * fo.y / W;
  float sy = clamp((fl.z + foldAmp * fo.z / H) / max(keep, 0.04), -2.5, 2.5);   // bounded: a bunched sail must not shade as razors
  vec3 axis = aft ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 hdir = aft ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
  float na = dot(n, axis);
  float sgn = na < 0.0 ? -1.0 : 1.0;
  if (abs(na) > 0.2) {
    float fh = -dot(n, hdir) / na * k + (aft ? -sh : sh);
    float fy = -n.y / na * k / max(1.0 - g, 0.05) + sy;
    n = normalize(sgn * (axis - fh * hdir - fy * vec3(0.0, 1.0, 0.0)));
  }
  p += axis * da;
}
`;

const NORMAL_HOOK = '#include <beginnormal_vertex>\nvec3 clothP = position;\nclothDeform(clothP, objectNormal);';

/** Patch a `MeshStandardMaterial` (sail, jib or yards) with the cloth vertex shader and the ship's uniforms. */
export function patchSailMaterial(material: THREE.Material, uniforms: ClothUniforms): void {
  material.onBeforeCompile = (shader): void => {
    assignClothUniforms(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${HEAD}`)
      .replace('#include <beginnormal_vertex>', NORMAL_HOOK)
      .replace('#include <begin_vertex>', 'vec3 transformed = clothP;');
  };
  material.customProgramCacheKey = (): string => SAIL_PROGRAM_KEY;
  material.needsUpdate = true;
}

/** Depth material for the shadow map that follows the same displacement (assign to `mesh.customDepthMaterial`). */
export function createClothDepthMaterial(uniforms: ClothUniforms): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader): void => {
    assignClothUniforms(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${HEAD}`)
      .replace('#include <begin_vertex>', 'vec3 transformed = position;\nvec3 clothN = normal;\nclothDeform(transformed, clothN);');
  };
  material.customProgramCacheKey = (): string => `${SAIL_PROGRAM_KEY}-depth`;
  return material;
}

/** GLSL source of the cloth patch (for tests: it is only compiled by a real GL context). */
export const clothShaderSource = HEAD;
