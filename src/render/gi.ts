import * as THREE from 'three';
import type { SeaLook } from './seaLook';
import { createSky } from './sky';

/** The sky's light seen from the sea: how often it is refreshed, and its resolution. */
const CUBE_SIZE = 128;
const REFRESH_SECONDS = 1.5;
/** Refresh at once when the sea state moved this much since the last probe. */
const REFRESH_STATE = 0.04;

/**
 * Image-based lighting from the live sky: the sky dome (colours of the hour and weather, clouds, sun) and the
 * sea below the horizon are drawn into a small cube map every second or so, filtered with PMREM, and set as the
 * scene's environment. Every standard material (hulls, sails, crew, terrain) then gets its ambient and reflected
 * light from where it stands: blue-white from above, sea-green from below, warm near the sun. This is the
 * "sky" level of global illumination; the screen-space levels build on it.
 */
export interface SkyLight {
  /** Draw the probe if it is due. `intensity` scales how much light the environment adds. */
  update(look: SeaLook, time: number, windFrom: number, seaState: number, intensity: number): void;
  /** Stop lighting from the probe (the scene falls back to its hemisphere light). */
  disable(): void;
  readonly active: boolean;
  dispose(): void;
}

export function createSkyLight(renderer: THREE.WebGLRenderer, scene: THREE.Scene): SkyLight {
  const skyScene = new THREE.Scene();
  const sky = createSky();
  skyScene.add(sky.mesh);
  const cube = new THREE.WebGLCubeRenderTarget(CUBE_SIZE, {
    type: renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType,
  });
  const camera = new THREE.CubeCamera(1, 3000, cube);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let filtered: THREE.WebGLRenderTarget | null = null;
  let lastTime = -Infinity;
  let lastState = -1;
  let active = false;
  const origin = new THREE.Camera();

  return {
    get active(): boolean {
      return active;
    },
    update(look, time, windFrom, seaState, intensity): void {
      scene.environmentIntensity = intensity;
      const due = !active || time - lastTime >= REFRESH_SECONDS || time < lastTime || Math.abs(seaState - lastState) >= REFRESH_STATE;
      if (!due) return;
      lastTime = time;
      lastState = seaState;
      sky.update(origin, look, time, windFrom);
      const autoClear = renderer.autoClear;
      renderer.autoClear = true;
      camera.update(renderer, skyScene);
      renderer.autoClear = autoClear;
      const next = pmrem.fromCubemap(cube.texture);
      scene.environment = next.texture;
      filtered?.dispose();
      filtered = next;
      active = true;
    },
    disable(): void {
      if (!active) return;
      scene.environment = null;
      filtered?.dispose();
      filtered = null;
      active = false;
    },
    dispose(): void {
      this.disable();
      pmrem.dispose();
      cube.dispose();
      sky.dispose();
    },
  };
}
