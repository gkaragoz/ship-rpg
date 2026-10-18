import * as THREE from 'three';

/**
 * Sail cloth on the GPU: a vertex-shader patch for the ship's cloned sail material (and its yards material), plus a
 * matching depth material so the shadow follows the cloth. The CPU only feeds a few smoothed numbers per ship
 * (`ClothUniforms`, see `clothState.ts`); the mesh attributes come from `clothGeometry.ts`.
 *
 * - **furl**: each tier gathers up towards its own yard (ruched: sine folds, thicker as it bunches, the corners
 *   rise first) while the yards stay put, so tiers never overlap and nothing sinks into the shrouds;
 * - **belly**: the baked billow is scaled by a signed amount, so a sail fills, empties and fills on the other side
 *   smoothly (square sails never push back through the mast plane);
 * - **flutter**: travelling high-frequency ripples, strongest near the irons, in gusts and where the sail is torn;
 * - edges stay pinned; normals come from the baked ones tilted by finite differences of the displacement.
 *
 * Every ship's material shares one GL program (`customProgramCacheKey`); only the uniform values differ.
 */
export interface ClothUniforms {
  /** Furl of tier slots 0…2 (bottom up) and of the fore-and-aft sails: 0 open … 1 gathered. */
  furl: THREE.IUniform<THREE.Vector4>;
  /** Belly of the square sails (0…1) and the fore-and-aft sails (−1…1). */
  belly: THREE.IUniform<THREE.Vector2>;
  /** Flutter (0…1.2) of the square and the fore-and-aft sails. */
  flutter: THREE.IUniform<THREE.Vector2>;
  /** Damage: the lower part of every tier is torn up (0…1). */
  tear: THREE.IUniform<number>;
  /** Apparent wind for the flags: (angle from the bow, speed m/s, gust, 0). */
  wind: THREE.IUniform<THREE.Vector4>;
}

/** Shared by every cloth material: seconds, wrapped to keep float precision (see `tickClothTime`). */
export const clothTime: THREE.IUniform<number> = { value: 0 };

export function tickClothTime(seconds: number): void {
  clothTime.value = seconds % 3600;
}

export function createClothUniforms(): ClothUniforms {
  return {
    furl: { value: new THREE.Vector4() },
    belly: { value: new THREE.Vector2(0.9, 0.9) }, // a ship nobody trims (the gallery) shows filled sails
    flutter: { value: new THREE.Vector2() },
    tear: { value: 0 },
    wind: { value: new THREE.Vector4(0, 8, 1, 0) },
  };
}

export const SAIL_PROGRAM_KEY = 'cloth-sail-1';

const HEAD = /* glsl */ `
attribute vec4 clothA;
attribute vec4 clothB;
uniform vec4 uFurl;
uniform vec2 uBelly;
uniform vec2 uFlutter;
uniform float uTear;
uniform float uTime;

// Axis-displacement of the folds and the flutter only (no baked belly): used for the shape and for its slopes.
float clothWob(float u, float dn, float g, float H, float W, float seed, float flutter, bool aft) {
  float thick = 0.08 * H * g * smoothstep(0.05, 0.3, g);
  float fold = thick * (0.5 + 0.5 * sin(dn * 14.0 + u * 5.0 + seed * 6.2832));
  float edge = sin(3.14159 * clamp(u, 0.0, 1.0)) * sin(3.14159 * clamp(1.0 - dn, 0.0, 1.0));
  float amp = flutter * 0.03 * clamp(H, 2.0, 9.0) * edge * (1.0 - g);
  float w = 0.6 * sin(u * 9.0 + (1.0 - dn) * 5.0 - uTime * 11.0 + seed * 6.2832) + 0.4 * sin(u * 17.0 - dn * 11.0 + uTime * 19.0 + seed * 3.1);
  w *= 0.5 + 0.5 * sin(uTime * 2.3 + seed * 4.0);
  return fold + (aft ? amp * w : amp * (0.5 + 0.5 * w));
}

void clothDeform(inout vec3 p, inout vec3 n) {
  float code = clothA.x;
  if (code < 0.5) return;
  float rigid = step(10.0, code);
  float slot = mod(code, 10.0);
  bool aft = slot > 3.5;
  float furl = slot < 1.5 ? uFurl.x : slot < 2.5 ? uFurl.y : slot < 3.5 ? uFurl.z : uFurl.w;
  float belly = aft ? uBelly.y : uBelly.x;
  float flutter = aft ? uFlutter.y : uFlutter.x;
  float yTop = clothB.x;
  float H = clothB.y;
  float W = clothB.z;
  float seed = clothB.w;
  if (H < 0.05) return;
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
  p.y += dy;
  if (rigid > 0.5) return;

  float baked = clothA.w;
  float k = belly * (1.0 - g);
  float wob = clothWob(u, dn, g, H, W, seed, flutter, aft);
  float da = (k - 1.0) * baked + wob;
  // Normal: the baked one tilted by the slopes of the displaced surface (axis offset over the two in-plane directions).
  float eu = 0.04, ed = 0.03;
  float sh = (clothWob(u + eu, dn, g, H, W, seed, flutter, aft) - wob) / (eu * W);
  float sy = -(clothWob(u, dn + ed, g, H, W, seed, flutter, aft) - wob) / (ed * H * max(keep, 0.04));
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

/** Patch a `MeshStandardMaterial` (sail or yards) with the cloth vertex shader and the ship's uniforms. */
export function patchSailMaterial(material: THREE.Material, uniforms: ClothUniforms): void {
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.uFurl = uniforms.furl;
    shader.uniforms.uBelly = uniforms.belly;
    shader.uniforms.uFlutter = uniforms.flutter;
    shader.uniforms.uTear = uniforms.tear;
    shader.uniforms.uTime = clothTime;
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
    shader.uniforms.uFurl = uniforms.furl;
    shader.uniforms.uBelly = uniforms.belly;
    shader.uniforms.uFlutter = uniforms.flutter;
    shader.uniforms.uTear = uniforms.tear;
    shader.uniforms.uTime = clothTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${HEAD}`)
      .replace('#include <begin_vertex>', 'vec3 transformed = position;\nvec3 clothN = normal;\nclothDeform(transformed, clothN);');
  };
  material.customProgramCacheKey = (): string => `${SAIL_PROGRAM_KEY}-depth`;
  return material;
}

/** GLSL source of the cloth patch (for tests: it is only compiled by a real GL context). */
export const clothShaderSource = HEAD;
