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
uniform vec3 uMoon;
uniform float uDay;
uniform float uStars;
uniform float uTime;
uniform float uCover;
uniform float uStorm;
uniform vec2 uDrift;
uniform vec3 uGround;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

// A field of faint stars: one possible star per cell of the sky, twinkling.
float stars(vec3 d) {
  vec3 p = d * 150.0;
  vec3 g = floor(p);
  float h = hash3(g);
  float r = length(fract(p) - 0.5);
  return step(0.985, h) * smoothstep(0.32, 0.0, r) * (0.55 + 0.45 * sin(uTime * 2.3 + h * 90.0));
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
  float sunUp = smoothstep(-0.05, 0.1, uSun.y);
  col += vec3(1.0, 0.9, 0.7) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18) * sunShow * sunUp;
  // the moon: a disc with a halo, bright against the dark sky
  float m = max(dot(d, uMoon), 0.0);
  float night = 1.0 - uDay;
  col += vec3(0.82, 0.88, 1.0) * (smoothstep(0.99985, 0.99991, m) * 1.6 + pow(m, 300.0) * 0.25 + pow(m, 24.0) * 0.04) * night * smoothstep(-0.05, 0.1, uMoon.y) * (1.0 - uStorm * 0.85);
  float starLight = d.y > 0.0 ? stars(d) * uStars * smoothstep(0.0, 0.15, d.y) : 0.0;
  if (d.y > 0.0) {
    // Clouds on a flat layer: perspective-squashed towards the horizon, drifting with the wind.
    float n = fbm(d.xz / (d.y + 0.14) * 0.85 + uDrift);
    float dens = smoothstep(1.0 - uCover, 1.0 - uCover + 0.28, n) * smoothstep(0.0, 0.1, d.y);
    vec3 lit = mix(vec3(1.0, 0.98, 0.94), vec3(0.36, 0.39, 0.43), uStorm);
    lit *= 0.82 + 0.3 * s;
    // clouds are lit by the day and nearly black at night; they hide the stars behind them
    lit *= 0.1 + 0.9 * uDay;
    col = mix(col, mix(lit, uHorizon, 0.25), dens * 0.92);
    starLight *= 1.0 - dens;
  }
  col += vec3(0.8, 0.88, 1.0) * starLight * 1.2;
  // Below the horizon is the sea: only seen in the light probe (the real sea covers it on screen).
  col = mix(col, uGround, smoothstep(0.0, 0.3, -d.y));
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
      uSun: { value: SUN_DIR.clone() },
      uMoon: { value: new THREE.Vector3(0, -1, 0) },
      uDay: { value: 1 },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uCover: { value: 0.3 },
      uStorm: { value: 0 },
      uDrift: { value: new THREE.Vector2() },
      uGround: { value: new THREE.Color(0x1a5a72) },
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
      (u.uSun!.value as THREE.Vector3).copy(look.sunDir);
      (u.uMoon!.value as THREE.Vector3).copy(look.moonDir);
      u.uDay!.value = look.daylight;
      u.uStars!.value = look.stars;
      u.uTime!.value = time;
      (u.uGround!.value as THREE.Color).copy(look.deep).lerp(look.shallow, 0.4).multiplyScalar(1.4);
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
