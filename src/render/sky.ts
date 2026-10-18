import * as THREE from 'three';
import { HORIZON_COLOR, SUN_DIR } from './ocean';

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
varying vec3 vDir;
void main() {
  float up = clamp(vDir.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  float s = clamp(dot(normalize(vDir), uSun), 0.0, 1.0);
  col += vec3(1.0, 0.9, 0.7) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export interface Sky {
  mesh: THREE.Mesh;
  /** Keep the dome centred on the camera. */
  update(camera: THREE.Camera): void;
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
      uHorizon: { value: HORIZON_COLOR },
      uZenith: { value: new THREE.Color(0x3f7db0) },
      uSun: { value: SUN_DIR },
    },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    update: (camera) => mesh.position.copy(camera.position),
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
