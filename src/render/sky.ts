import * as THREE from 'three';
import { HORIZON_COLOR, SUN_DIR, type SeaLook } from './seaLook';

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSun;
uniform float uCover;
uniform float uStorm;
uniform vec2 uDrift;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  float s = clamp(dot(d, uSun), 0.0, 1.0);
  float sunShow = 1.0 - uStorm * 0.8;
  col += vec3(1.0, 0.9, 0.7) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18) * sunShow;
  if (d.y > 0.0) {
    // Clouds on a flat layer: perspective-squashed towards the horizon, drifting with the wind.
    float n = fbm(d.xz / (d.y + 0.14) * 0.85 + uDrift);
    float dens = smoothstep(1.0 - uCover, 1.0 - uCover + 0.28, n) * smoothstep(0.0, 0.1, d.y);
    vec3 lit = mix(vec3(1.0, 0.98, 0.94), vec3(0.36, 0.39, 0.43), uStorm);
    lit *= 0.82 + 0.3 * s;
    col = mix(col, mix(lit, uHorizon, 0.25), dens * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export interface Sky {
  mesh: THREE.Mesh;
  /** Keep the dome centred on the camera; colours and clouds follow the day's look. */
  update(camera: THREE.Camera, look: SeaLook, time: number, windFrom: number): void;
  dispose(): void;
}

export function createSky(): Sky {
  const geometry = new THREE.SphereGeometry(1500, 24, 16);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: HORIZON_COLOR.clone() },
      uZenith: { value: new THREE.Color(0x3f7db0) },
      uSun: { value: SUN_DIR },
      uCover: { value: 0.3 },
      uStorm: { value: 0 },
      uDrift: { value: new THREE.Vector2() },
    },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    update(camera, look, time, windFrom): void {
      mesh.position.copy(camera.position);
      const u = material.uniforms;
      (u.uHorizon!.value as THREE.Color).copy(look.horizon);
      (u.uZenith!.value as THREE.Color).copy(look.zenith);
      u.uCover!.value = look.cover;
      u.uStorm!.value = look.storm;
      // clouds blow the way the wind blows
      // (the offset is added to the lookup, so the pattern moves the other way: with the wind)
      (u.uDrift!.value as THREE.Vector2).set(-Math.cos(windFrom + Math.PI) * time * 0.004, Math.sin(windFrom + Math.PI) * time * 0.004);
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
