import * as THREE from 'three';
import { createOcean } from './ocean';
import type { Quality } from './quality';
import { FOG_FAR, FOG_NEAR, HORIZON_COLOR, SUN_DIR, lookFor, type SeaLook } from './seaLook';
import { createSky } from './sky';
import { createWake, type Wake } from './wake';
import type { Stamp } from './wakeStamps';
import { seaAmp } from '../world';

/** What the environment needs to know each frame. */
export interface EnvironmentFrame {
  camera: THREE.Camera;
  /** Game (or gallery) time in seconds: the waves and clouds are a function of it. */
  time: number;
  dt: number;
  /** Where the wind comes from (see `core/views`) and how rough the sea is, 0…1. */
  windFrom: number;
  seaState: number;
  /** What ships and splashes leave on the water this frame. */
  stamps: readonly Stamp[];
}

/**
 * The open sea and sky both views share: the sea (clip-map mesh, wake map), the sky dome with clouds, the fog and
 * the sun and sky light, all following the day's look. The sailing view and the ship gallery stand in the same
 * environment, so the sea looks the same in both and a setting changes both.
 */
export interface Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly look: SeaLook;
  readonly wake: Wake;
  update(frame: EnvironmentFrame): void;
  setQuality(quality: Quality): void;
  dispose(): void;
}

/** Adds the sea, sky, fog and lights to `scene`. */
export function createEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, quality: Quality): Environment {
  scene.fog = new THREE.Fog(HORIZON_COLOR, FOG_NEAR, FOG_FAR);
  const hemi = new THREE.HemisphereLight(0xdcecf5, 0x2b4a5a, 1.4);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  const ocean = createOcean(quality);
  const wake = createWake(renderer, quality);
  const sky = createSky();
  const look = lookFor(0);
  let texels = quality.wake;
  scene.add(hemi, sun, ocean.object, sky.mesh);
  const fog = scene.fog as THREE.Fog;

  return {
    sun,
    hemi,
    look,
    wake,
    update(f): void {
      // The day's look follows the sea state: bright and clear when calm, grey, dark and close in a storm.
      lookFor(f.seaState, look);
      fog.color.copy(look.horizon);
      fog.near = look.fogNear;
      fog.far = look.fogFar;
      sun.intensity = look.sun;
      hemi.intensity = look.hemi;
      wake.update(renderer, f.dt, f.camera, f.stamps);
      ocean.setWake(wake, texels);
      ocean.update(f.camera, f.time, f.windFrom, seaAmp(f.seaState), f.seaState, look);
      sky.update(f.camera, look, f.time, f.windFrom);
    },
    setQuality(q): void {
      texels = q.wake;
      ocean.setQuality(q);
      wake.setQuality(q);
    },
    dispose(): void {
      ocean.dispose();
      sky.dispose();
      wake.dispose();
      scene.remove(hemi, sun, ocean.object, sky.mesh);
    },
  };
}
