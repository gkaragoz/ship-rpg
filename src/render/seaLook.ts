import * as THREE from 'three';
import { clamp } from '../core';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.5, -0.35).normalize();
/** Calm-weather horizon colour (kept for code that needs a default, e.g. the gallery). */
export const HORIZON_COLOR = new THREE.Color(0xb7d4e0);
/** Distant islands fade into the haze; the far sea is fully fogged before its own edge (fair weather). */
export const FOG_NEAR = 250;
export const FOG_FAR = 2400;

/** Everything about the colour and clarity of the day that the sea state changes. */
export interface SeaLook {
  horizon: THREE.Color;
  zenith: THREE.Color;
  deep: THREE.Color;
  shallow: THREE.Color;
  fogNear: number;
  fogFar: number;
  /** Direct sun and sky light strength. */
  sun: number;
  hemi: number;
  /** Cloud cover 0…1 and how dark and heavy the clouds are (0 fair, 1 storm). */
  cover: number;
  storm: number;
}

const CALM = {
  horizon: new THREE.Color(0xb7d4e0),
  zenith: new THREE.Color(0x3f7db0),
  deep: new THREE.Color(0x0e3a55),
  shallow: new THREE.Color(0x2f86a0),
  fogNear: FOG_NEAR,
  fogFar: FOG_FAR,
  sun: 2.4,
  hemi: 1.4,
  cover: 0.28,
};
const STORM = {
  horizon: new THREE.Color(0x77868e),
  zenith: new THREE.Color(0x38444d),
  deep: new THREE.Color(0x0a2633),
  shallow: new THREE.Color(0x254f5c),
  fogNear: 90,
  fogFar: 1500,
  sun: 0.9,
  hemi: 1.0,
  cover: 0.9,
};

/** Sea state 0…1 → the look of the day: bright and clear when calm, grey, dark and close in a storm. */
export function lookFor(seaState: number, out?: SeaLook): SeaLook {
  const t = clamp(seaState, 0, 1) ** 0.85;
  const look: SeaLook = out ?? {
    horizon: new THREE.Color(),
    zenith: new THREE.Color(),
    deep: new THREE.Color(),
    shallow: new THREE.Color(),
    fogNear: 0,
    fogFar: 0,
    sun: 0,
    hemi: 0,
    cover: 0,
    storm: 0,
  };
  look.horizon.copy(CALM.horizon).lerp(STORM.horizon, t);
  look.zenith.copy(CALM.zenith).lerp(STORM.zenith, t);
  look.deep.copy(CALM.deep).lerp(STORM.deep, t);
  look.shallow.copy(CALM.shallow).lerp(STORM.shallow, t);
  look.fogNear = CALM.fogNear + (STORM.fogNear - CALM.fogNear) * t;
  look.fogFar = CALM.fogFar + (STORM.fogFar - CALM.fogFar) * t;
  look.sun = CALM.sun + (STORM.sun - CALM.sun) * t;
  look.hemi = CALM.hemi + (STORM.hemi - CALM.hemi) * t;
  look.cover = CALM.cover + (STORM.cover - CALM.cover) * t;
  look.storm = t;
  return look;
}
