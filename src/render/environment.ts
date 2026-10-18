import * as THREE from 'three';
import { createSkyLight } from './gi';
import { createRain, type Rain } from './rain';
import { excludeFromOcclusion } from './pipeline';
import { createOcean } from './ocean';
import type { Quality } from './quality';
import { FOG_FAR, FOG_NEAR, HORIZON_COLOR, SUN_DIR, lookFor, type SeaLook } from './seaLook';
import { createSky } from './sky';
import { createShadows, shadowRadius, type Shadows } from './shadows';
import { createWake, type Wake } from './wake';
import type { SunShadow, Stamp } from './wakeStamps';
import type { GraphicsSettings, TextureQuality } from '../settings';
import { clamp } from '../core';
import { seaAmp, sunState, type SeaTuning } from '../world';

/** What the environment needs to know each frame. */
export interface EnvironmentFrame {
  camera: THREE.Camera;
  /** Game (or gallery) time in seconds: the waves and clouds are a function of it. */
  time: number;
  dt: number;
  /** Where the wind comes from (see `core/views`) and how rough the sea is, 0…1. */
  windFrom: number;
  seaState: number;
  /** The hour of the day, 0 ≤ h < 24 (see `world/clock.ts`): the sun, the moon and the colours follow it. */
  hour: number;
  /** The weather simulator's parts of the sky and the waves: the wave tuning, cloud cover and haze (null = the sky's own), and a lightning flash 0…1. */
  tuning: SeaTuning;
  cloud: number | null;
  fog: number | null;
  flash: number;
  /** Rain, 0 … 1. */
  rain: number;
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
  /** Where the main light's shadows fall on the sea, for the wake stamps (null while shadows are off or the light is out). */
  sunShadow(): SunShadow | null;
  update(frame: EnvironmentFrame): void;
  setQuality(quality: Quality): void;
  /** Apply the graphics settings that concern the environment: shadows, view distance, texture quality. */
  apply(graphics: GraphicsSettings): void;
  dispose(): void;
}

const FLASH = new THREE.Color(0xdbe6ff);

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
  const rain: Rain = createRain();
  let particles = 1;
  let skyGi = false;
  let texels = quality.wake;
  let viewDistance = 1;
  let shadowScale = 1;
  let textures: TextureQuality | null = null;
  const cast: SunShadow = { dirX: 1, dirZ: 0, elevation: 1, strength: 1 };
  excludeFromOcclusion(ocean.object);
  excludeFromOcclusion(sky.mesh);
  scene.add(hemi, sun, ocean.object, sky.mesh, rain.object);
  const fog = scene.fog as THREE.Fog;

  const env: Environment = {
    sun,
    hemi,
    look,
    wake,
    shadows,
    sunShadow: () => (shadows.enabled && cast.strength > 0.05 ? cast : null),
    apply(g): void {
      shadows.apply(g);
      viewDistance = g.viewDistance;
      shadowScale = g.shadowDistance;
      skyGi = g.globalIllumination !== 'off';
      particles = g.particles;
      if (!skyGi) skyLight.disable();
      if (g.textures !== textures) {
        textures = g.textures;
        ocean.setTextures(textures, renderer.capabilities.getMaxAnisotropy());
      }
    },
    update(f): void {
      // The look follows the hour and the sea state: bright at noon, gold at dusk, dark blue by moonlight, grey in a storm.
      lookFor(f.seaState, sunState(f.hour), look);
      if (f.cloud !== null) look.cover = f.cloud;
      if (f.fog !== null) {
        look.fogNear *= 1 - 0.9 * f.fog; // thick haze closes the view in
        look.fogFar *= 1 - 0.85 * f.fog;
      }
      if (f.flash > 0) {
        // a lightning flash: the whole sky and the fill light jump bright for an instant
        look.horizon.lerp(FLASH, f.flash * 0.8);
        look.zenith.lerp(FLASH, f.flash * 0.6);
        look.hemi += f.flash * 3;
      }
      look.fogNear *= viewDistance; // the view distance setting scales how far you see
      look.fogFar *= viewDistance;
      fog.color.copy(look.horizon);
      fog.near = look.fogNear;
      fog.far = look.fogFar;
      // the main light is the sun by day and the moon by night
      sun.position.copy(look.lightDir).multiplyScalar(100);
      sun.color.copy(look.lightColor);
      sun.intensity = look.sun;
      hemi.color.copy(look.hemiSky);
      hemi.groundColor.copy(look.hemiGround);
      const horizontal = Math.hypot(look.lightDir.x, look.lightDir.z) || 1;
      cast.dirX = -look.lightDir.x / horizontal;
      cast.dirZ = -look.lightDir.z / horizontal;
      cast.elevation = Math.asin(clamp(look.lightDir.y, -1, 1));
      cast.strength = clamp(look.sun / 2.4, 0, 1);
      // With the sky probe lighting the standard materials, the flat hemisphere light only fills in.
      hemi.intensity = look.hemi * (skyGi ? 0.3 : 1);
      if (skyGi) skyLight.update(look, f.time, f.windFrom, f.seaState, 0.9 * Math.max(look.hemi / 1.4, 0.5), f.hour);
      wake.update(renderer, f.dt, f.camera, f.stamps);
      ocean.setWake(wake, texels);
      ocean.update(f.camera, f.time, f.windFrom, seaAmp(f.seaState), f.seaState, look, f.tuning);
      sky.update(f.camera, look, f.time, f.windFrom);
      rain.update(f.camera, f.time, f.windFrom, f.rain, particles, look.horizon);
      if (f.focus) shadows.update(f.focus.position, look.lightDir, shadowRadius(f.focus.length, shadowScale));
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
      rain.dispose();
      scene.remove(hemi, sun, ocean.object, sky.mesh, rain.object);
    },
  };
  // In dev the environment and renderer are on window, for poking at from the console.
  if (import.meta.env.DEV) Object.assign(window, { __env: env, __renderer: renderer, __scene: scene });
  return env;
}
