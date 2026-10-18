import * as THREE from 'three';
import { createSkyLight } from './gi';
import { excludeFromOcclusion } from './pipeline';
import { createOcean } from './ocean';
import type { Quality } from './quality';
import { FOG_FAR, FOG_NEAR, HORIZON_COLOR, SUN_DIR, lookFor, type SeaLook } from './seaLook';
import { createSky } from './sky';
import { createShadows, shadowRadius, type Shadows } from './shadows';
import { createWake, type Wake } from './wake';
import type { SunShadow, Stamp } from './wakeStamps';
import type { GraphicsSettings, TextureQuality } from '../settings';
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
  /** The ship the sun's shadow map follows, and its length (m); none keeps the map where it was. */
  focus?: { position: THREE.Vector3; length: number };
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
  readonly shadows: Shadows;
  /** Where the sun's shadows fall on the sea, for the wake stamps (null while shadows are off). */
  sunShadow(): SunShadow | null;
  update(frame: EnvironmentFrame): void;
  setQuality(quality: Quality): void;
  /** Apply the graphics settings that concern the environment: shadows, view distance, texture quality. */
  apply(graphics: GraphicsSettings): void;
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
  const shadows = createShadows(renderer, scene, sun);
  const skyLight = createSkyLight(renderer, scene);
  let skyGi = false;
  let texels = quality.wake;
  let viewDistance = 1;
  let shadowScale = 1;
  let textures: TextureQuality | null = null;
  const towardSun = SUN_DIR.clone();
  const cast: SunShadow = { dirX: -towardSun.x, dirZ: -towardSun.z, elevation: Math.asin(towardSun.y) };
  const horizontal = Math.hypot(cast.dirX, cast.dirZ) || 1;
  cast.dirX /= horizontal;
  cast.dirZ /= horizontal;
  excludeFromOcclusion(ocean.object);
  excludeFromOcclusion(sky.mesh);
  scene.add(hemi, sun, ocean.object, sky.mesh);
  const fog = scene.fog as THREE.Fog;

  const env: Environment = {
    sun,
    hemi,
    look,
    wake,
    shadows,
    sunShadow: () => (shadows.enabled ? cast : null),
    apply(g): void {
      shadows.apply(g);
      viewDistance = g.viewDistance;
      shadowScale = g.shadowDistance;
      skyGi = g.globalIllumination !== 'off';
      if (!skyGi) skyLight.disable();
      if (g.textures !== textures) {
        textures = g.textures;
        ocean.setTextures(textures, renderer.capabilities.getMaxAnisotropy());
      }
    },
    update(f): void {
      // The day's look follows the sea state: bright and clear when calm, grey, dark and close in a storm.
      lookFor(f.seaState, look);
      look.fogNear *= viewDistance; // the view distance setting scales how far you see
      look.fogFar *= viewDistance;
      fog.color.copy(look.horizon);
      fog.near = look.fogNear;
      fog.far = look.fogFar;
      sun.intensity = look.sun;
      // With the sky probe lighting the standard materials, the flat hemisphere light only fills in.
      hemi.intensity = look.hemi * (skyGi ? 0.3 : 1);
      if (skyGi) skyLight.update(look, f.time, f.windFrom, f.seaState, 0.9 * (look.hemi / 1.4));
      wake.update(renderer, f.dt, f.camera, f.stamps);
      ocean.setWake(wake, texels);
      ocean.update(f.camera, f.time, f.windFrom, seaAmp(f.seaState), f.seaState, look);
      sky.update(f.camera, look, f.time, f.windFrom);
      if (f.focus) shadows.update(f.focus.position, towardSun, shadowRadius(f.focus.length, shadowScale));
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
      shadows.dispose();
      skyLight.dispose();
      scene.remove(hemi, sun, ocean.object, sky.mesh);
    },
  };
  // In dev the environment and renderer are on window, for poking at from the console.
  if (import.meta.env.DEV) Object.assign(window, { __env: env, __renderer: renderer, __scene: scene });
  return env;
}
