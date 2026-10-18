import * as THREE from 'three';
import { waveGlsl } from './waves';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.5, -0.35).normalize();
export const HORIZON_COLOR = new THREE.Color(0xb7d4e0);
/** Fully fogged before the 450 m half-size of the ocean mesh, so its edge never shows. */
export const FOG_NEAR = 180;
export const FOG_FAR = 420;

const SIZE = 900;
const SEGMENTS = 360;
const CELL = SIZE / SEGMENTS;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uAmp;
varying vec3 vWorld;
varying float vHeight;
${waveGlsl()}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float h = oceanHeight(w.xz);
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
  col = mix(col, uSky, fres * 0.55);
  float spec = pow(clamp(dot(reflect(-uSun, n), v), 0.0, 1.0), 60.0);
  col += vec3(1.0, 0.95, 0.8) * spec * 0.6;
  col = mix(col, uSky, smoothstep(uFogNear, uFogFar, distance(cameraPosition, vWorld)));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export interface Ocean {
  mesh: THREE.Mesh;
  /** Re-centre under the camera and advance the waves. */
  update(camera: THREE.Camera, time: number, windFrom: number, ampScale: number): void;
  dispose(): void;
}

/** Wave-displaced sea around the camera; flat-shaded for a low-poly look. */
export function createOcean(): Ocean {
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
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
    },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // vertices are displaced in the shader

  return {
    mesh,
    update(camera, time, windFrom, ampScale): void {
      // Snap to the vertex grid so the mesh never visibly slides against the waves.
      mesh.position.x = Math.round(camera.position.x / CELL) * CELL;
      mesh.position.z = Math.round(camera.position.z / CELL) * CELL;
      material.uniforms.uTime!.value = time;
      material.uniforms.uWind!.value = windFrom;
      material.uniforms.uAmp!.value = ampScale;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
