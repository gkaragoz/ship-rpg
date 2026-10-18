import * as THREE from 'three';
import { excludeFromOcclusion } from './pipeline';

/** Streaks in the pool, the half side (m) of the box of rain around the camera, and its height. */
const RAIN_TINT = new THREE.Color(0.9, 0.93, 1);
const STREAKS = 5000;
const BOX = 45;
const HEIGHT = 50;

const vertexShader = /* glsl */ `
attribute vec3 seed;
attribute float tip;
uniform vec3 uCenter;
uniform float uTime;
uniform float uDensity;
uniform vec2 uSlant;
varying float vFade;
const float BOX = ${BOX.toFixed(1)};
const float HEIGHT = ${HEIGHT.toFixed(1)};
void main() {
  vec3 base = seed * vec3(2.0 * BOX, HEIGHT, 2.0 * BOX) - vec3(BOX, 0.0, BOX);
  float y = mod(base.y - uTime * 24.0, HEIGHT);
  // the box follows the camera: every drop keeps its place in the world and wraps round the camera
  vec2 xz = uCenter.xz + mod(base.xz - uCenter.xz + BOX, 2.0 * BOX) - BOX + uSlant * (HEIGHT - y) * 0.08;
  vec3 world = vec3(xz.x, y, xz.y);
  world.y += tip * 1.3;
  world.xz += tip * uSlant * 0.35;
  float away = length(world.xz - uCenter.xz);
  vFade = step(seed.z * 0.999, uDensity) * (1.0 - tip * 0.75) * smoothstep(BOX, BOX * 0.35, away);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, vFade * uAlpha);
  #include <colorspace_fragment>
}`;

/** Rain around the camera: streaks that fall, slant with the wind and fade with distance. */
export interface Rain {
  readonly object: THREE.Object3D;
  /** `intensity` 0…1, `density` the particle setting, `color` the haze colour that tints the drops. */
  update(camera: THREE.Camera, time: number, windFrom: number, intensity: number, density: number, color: THREE.Color): void;
  dispose(): void;
}

export function createRain(): Rain {
  const seeds = new Float32Array(STREAKS * 2 * 3);
  const tips = new Float32Array(STREAKS * 2);
  const positions = new Float32Array(STREAKS * 2 * 3); // unused by the shader but three needs a position attribute
  let state = 1234567;
  const rand = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < STREAKS; i++) {
    const x = rand();
    const y = rand();
    const z = rand();
    for (let v = 0; v < 2; v++) {
      seeds.set([x, y, z], (i * 2 + v) * 3);
      tips[i * 2 + v] = v;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
  geometry.setAttribute('tip', new THREE.BufferAttribute(tips, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uCenter: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uDensity: { value: 1 },
      uSlant: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Color(0.75, 0.8, 0.9) },
      uAlpha: { value: 0 },
    },
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.visible = false;
  excludeFromOcclusion(lines);
  const u = material.uniforms;
  return {
    object: lines,
    update(camera, time, windFrom, intensity, density, color): void {
      lines.visible = intensity > 0.02;
      if (!lines.visible) return;
      (u.uCenter!.value as THREE.Vector3).copy(camera.position);
      u.uTime!.value = time;
      u.uDensity!.value = Math.min(1, intensity * 1.1) * Math.min(1, 0.35 + density * 0.65);
      u.uAlpha!.value = 0.25 + 0.4 * intensity;
      // drops slant the way the wind blows
      const a = windFrom + Math.PI;
      (u.uSlant!.value as THREE.Vector2).set(Math.cos(a), -Math.sin(a)).multiplyScalar(1 + 3 * intensity);
      (u.uColor!.value as THREE.Color).copy(color).lerp(RAIN_TINT, 0.35);
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
