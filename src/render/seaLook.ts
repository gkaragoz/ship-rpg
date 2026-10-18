import * as THREE from 'three';
import { clamp } from '../core';
import type { SunState } from '../world';

/** Where the sun stood when the sea and sky were first tuned: kept as the default and for tests. */
export const SUN_DIR = new THREE.Vector3(-0.45, 0.5, -0.35).normalize();
/** Calm-weather horizon colour (kept for code that needs a default, e.g. the gallery). */
export const HORIZON_COLOR = new THREE.Color(0xb7d4e0);
/** Distant islands fade into the haze; the far sea is fully fogged before its own edge (fair weather, by day). */
export const FOG_NEAR = 250;
export const FOG_FAR = 2400;

/** Everything about the colour and clarity of the moment that the weather and the hour change. */
export interface SeaLook {
  horizon: THREE.Color;
  zenith: THREE.Color;
  deep: THREE.Color;
  shallow: THREE.Color;
  /** Sky and ground colours of the hemisphere (fill) light. */
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  fogNear: number;
  fogFar: number;
  /** The main light: towards the sun by day, the moon by night, its colour and strength. */
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  sun: number;
  hemi: number;
  /** The sun and the moon themselves, for the sky. */
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** Cloud cover 0…1 and how dark and heavy the clouds are (0 fair, 1 storm). */
  cover: number;
  storm: number;
  /** 0 night … 1 day, the orange hours, how visible the stars are, and how brightly ship lamps and windows glow. */
  daylight: number;
  twilight: number;
  stars: number;
  lamps: number;
}

interface Palette {
  horizon: THREE.Color;
  zenith: THREE.Color;
  deep: THREE.Color;
  shallow: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  fogNear: number;
  fogFar: number;
  sun: number;
  hemi: number;
  cover: number;
}

const color = (hex: number): THREE.Color => new THREE.Color(hex);

const DAY: Palette = {
  horizon: color(0xb7d4e0), zenith: color(0x3f7db0), deep: color(0x0e3a55), shallow: color(0x2f86a0),
  hemiSky: color(0xdcecf5), hemiGround: color(0x2b4a5a), fogNear: FOG_NEAR, fogFar: FOG_FAR, sun: 2.4, hemi: 1.4, cover: 0.28,
};
/** Sunrise and sunset: warm horizon, a deeper blue above, a gold low sun. */
const TWILIGHT: Palette = {
  horizon: color(0xf0a072), zenith: color(0x4b6a9a), deep: color(0x14354d), shallow: color(0x2c5a72),
  hemiSky: color(0xf2c9a6), hemiGround: color(0x24404f), fogNear: 180, fogFar: 2000, sun: 1.5, hemi: 0.9, cover: 0.35,
};
const NIGHT: Palette = {
  horizon: color(0x1b2e4c), zenith: color(0x040a16), deep: color(0x061d2d), shallow: color(0x123b52),
  hemiSky: color(0x4a6290), hemiGround: color(0x10263a), fogNear: 90, fogFar: 1700, sun: 0.9, hemi: 0.55, cover: 0.3,
};
const STORM: Palette = {
  horizon: color(0x77868e), zenith: color(0x38444d), deep: color(0x0a2633), shallow: color(0x254f5c),
  hemiSky: color(0x9aa9b0), hemiGround: color(0x22343c), fogNear: 90, fogFar: 1500, sun: 0.9, hemi: 1.0, cover: 0.9,
};

const SUN_COLOR = color(0xfff0cc);
const SUN_LOW_COLOR = color(0xff9c55);
const MOON_COLOR = color(0x8fa6d8);

const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A scratch colour for the blends below. */
const tmp = new THREE.Color();

/** `out` ← the colour `key` of the palettes blended for the hour (night → day, then twilight) and the weather. */
function blend(key: 'horizon' | 'zenith' | 'deep' | 'shallow' | 'hemiSky' | 'hemiGround', out: THREE.Color, day: number, twilight: number, storm: number): void {
  out.copy(NIGHT[key]).lerp(DAY[key], day);
  out.lerp(TWILIGHT[key], twilight * 0.85 * (1 - 0.5 * storm));
  // a storm is as dark as the hour: grey by day, black at night
  tmp.copy(STORM[key]).multiplyScalar(0.12 + 0.88 * day);
  out.lerp(tmp, storm);
}

/**
 * The day's look for a sea state and an hour: bright and clear at noon, gold and orange at sunrise and sunset, dark
 * blue under the moon, and grey, dark and close in a storm.
 */
export function lookFor(seaState: number, sun?: SunState, out?: SeaLook): SeaLook {
  const storm = clamp(seaState, 0, 1) ** 0.85;
  const day = sun?.daylight ?? 1;
  const twilight = sun?.twilight ?? 0;
  const look: SeaLook = out ?? {
    horizon: new THREE.Color(), zenith: new THREE.Color(), deep: new THREE.Color(), shallow: new THREE.Color(),
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), fogNear: 0, fogFar: 0,
    lightDir: SUN_DIR.clone(), lightColor: new THREE.Color(), sun: 0, hemi: 0,
    sunDir: SUN_DIR.clone(), moonDir: new THREE.Vector3(0, -1, 0),
    cover: 0, storm: 0, daylight: 1, twilight: 0, stars: 0, lamps: 0,
  };
  for (const key of ['horizon', 'zenith', 'deep', 'shallow', 'hemiSky', 'hemiGround'] as const) blend(key, look[key], day, twilight, storm);
  look.fogNear = mix(mix(NIGHT.fogNear, DAY.fogNear, day), STORM.fogNear, storm);
  look.fogFar = mix(mix(NIGHT.fogFar, DAY.fogFar, day), STORM.fogFar, storm);
  look.cover = mix(mix(DAY.cover, TWILIGHT.cover, twilight), STORM.cover, storm);
  look.hemi = mix(mix(NIGHT.hemi, DAY.hemi, day), STORM.hemi * (0.2 + 0.8 * day), storm);
  look.storm = storm;
  look.daylight = day;
  look.twilight = twilight;
  look.stars = smoothstep(0.35, 0.0, day);
  look.lamps = 1 - smoothstep(0.15, 0.7, day);

  // The main light: the sun while it is up, the moon after; they cross-fade around the horizon.
  const sunDir = sun ? new THREE.Vector3(...sun.sun) : SUN_DIR;
  const moonDir = sun ? new THREE.Vector3(...sun.moon) : new THREE.Vector3(0, -1, 0);
  look.sunDir.copy(sunDir);
  look.moonDir.copy(moonDir);
  const sunUp = sunDir.y;
  const sunWeight = smoothstep(-0.08, 0.1, sunUp);
  look.lightDir.copy(moonDir).lerp(sunDir, sunWeight).normalize();
  look.lightColor.copy(MOON_COLOR).lerp(SUN_COLOR, sunWeight).lerp(SUN_LOW_COLOR, twilight * 0.8 * sunWeight);
  const sunStrength = mix(mix(DAY.sun, TWILIGHT.sun, twilight), STORM.sun, storm) * sunWeight;
  const moonStrength = NIGHT.sun * smoothstep(-0.05, 0.2, moonDir.y) * (1 - sunWeight) * (1 - 0.6 * storm);
  look.sun = sunStrength + moonStrength;
  return look;
}
