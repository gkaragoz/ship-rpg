import { clamp } from '../core';

/**
 * The sea surface as a sum of Gerstner waves: every point travels in a circle, so crests sharpen and
 * troughs flatten as the sea builds. One definition drives the vertex shader (`render/waves.ts`
 * generates its GLSL from `WAVES`), ships riding it (`gameplay/buoyancy.ts`, `render/ride.ts`) and
 * the sea state that the weather, the HUD and the ship handling read.
 *
 * World convention as in `core/views`: x east, z south, y up; `windFrom` is where the wind comes FROM.
 */
export interface WaveSpec {
  /** Direction offset from the wind's travel direction, radians. */
  dir: number;
  /** Wavelength in metres. */
  length: number;
  /** Amplitude in metres at amplitude scale 1. */
  amplitude: number;
}

/** Long swell first, short wind chop last (the shader fades the short ones with distance). */
export const WAVES: readonly WaveSpec[] = [
  { dir: 0, length: 90, amplitude: 0.5 },
  { dir: 0.35, length: 60, amplitude: 0.35 },
  { dir: -0.5, length: 38, amplitude: 0.22 },
  { dir: 0.9, length: 24, amplitude: 0.12 },
  { dir: -1.0, length: 15, amplitude: 0.07 },
  { dir: 0.2, length: 9, amplitude: 0.035 },
  { dir: -0.3, length: 5.5, amplitude: 0.018 },
];

/** Waves shorter than this fade out with distance in the shader so far water does not shimmer. */
export const SHORT_WAVE = 50;

const GRAVITY = 9.81;
/** Horizontal crest pull: 0 is a plain sine, the cap keeps the surface from folding over itself. */
const CHOP = 1.4;
const MAX_FOLD = 0.9;

/** Deep-water wave number and angular frequency (rad/s) for each wave in `WAVES`. */
export const WAVE_TERMS: readonly { k: number; omega: number }[] = WAVES.map((w) => {
  const k = (2 * Math.PI) / w.length;
  return { k, omega: Math.sqrt(GRAVITY * k) };
});

/** Crest sharpness for an amplitude scale: `CHOP`, lowered when a big sea would otherwise fold. */
export function chop(ampScale: number): number {
  let slope = 0;
  WAVES.forEach((w, i) => (slope += (WAVE_TERMS[i]?.k ?? 0) * w.amplitude * ampScale));
  return slope > 0 ? Math.min(CHOP, MAX_FOLD / slope) : CHOP;
}

/** Direction (unit vector in x, z) the wave `i` travels, for a wind from `windFrom`. */
export function waveDirection(i: number, windFrom: number): [number, number] {
  const a = windFrom + Math.PI + (WAVES[i]?.dir ?? 0);
  return [Math.cos(a), -Math.sin(a)];
}

interface Sample {
  h: number;
  dx: number;
  dz: number;
}
const scratch: Sample = { h: 0, dx: 0, dz: 0 };

/** Height and horizontal pull of the surface above the rest position (px, pz). */
function surface(px: number, pz: number, time: number, windFrom: number, amp: number, g: number, minLength: number, out: Sample): Sample {
  let h = 0;
  let dx = 0;
  let dz = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    const t = WAVE_TERMS[i];
    if (!w || !t || w.length < minLength) continue;
    const [ux, uz] = waveDirection(i, windFrom);
    const theta = t.k * (ux * px + uz * pz) - t.omega * time;
    const a = w.amplitude * amp;
    h += a * Math.sin(theta);
    const pull = g * a * Math.cos(theta);
    dx += pull * ux;
    dz += pull * uz;
  }
  out.h = h;
  out.dx = dx;
  out.dz = dz;
  return out;
}

/**
 * Surface height (m) at world (x, z) as the eye sees it. The surface is displaced sideways, so the
 * rest position under the point is found by five fixed-point steps (the error is far below a centimetre). `minLength` leaves out waves
 * shorter than that: far-away overlays pass `SHORT_WAVE` to sit on the long swell they are sure to be above.
 */
export function waveHeight(x: number, z: number, time: number, windFrom: number, ampScale = 1, minLength = 0): number {
  const g = chop(ampScale);
  let px = x;
  let pz = z;
  for (let i = 0; i < 5; i++) {
    surface(px, pz, time, windFrom, ampScale, g, minLength, scratch);
    px = x - scratch.dx;
    pz = z - scratch.dz;
  }
  return surface(px, pz, time, windFrom, ampScale, g, minLength, scratch).h;
}

/** Surface slope (∂h/∂x, ∂h/∂z), by central differences over `step` metres. */
export function waveSlope(x: number, z: number, time: number, windFrom: number, ampScale = 1, step = 1): [number, number] {
  const e = step / 2;
  return [
    (waveHeight(x + e, z, time, windFrom, ampScale) - waveHeight(x - e, z, time, windFrom, ampScale)) / step,
    (waveHeight(x, z + e, time, windFrom, ampScale) - waveHeight(x, z - e, time, windFrom, ampScale)) / step,
  ];
}

const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Wind speed (m/s) below which the sea hardly builds, and the speed at which it is wind-driven to the full. */
const CALM_WIND = 3;
const GALE_WIND = 14;

/**
 * How rough the sea is, 0 (glassy) … 1 (storm). A pure function of game time and wind speed: the wind
 * builds it, and a slow, rare "storm cell" piles more on: the first comes after about 17 minutes of play, and storms then make up roughly a tenth of the time.
 */
export function seaStateAt(time: number, windSpeed: number): number {
  const wind = clamp((windSpeed - CALM_WIND) / (GALE_WIND - CALM_WIND), 0, 1);
  const a = 0.5 + 0.5 * Math.sin((time * 2 * Math.PI) / 760 - 1.9);
  const b = 0.5 + 0.5 * Math.sin((time * 2 * Math.PI) / 1930 - 1.9);
  const storm = smoothstep(0.55, 0.93, 0.55 * a + 0.45 * b);
  return clamp(wind * 0.65 + storm * 0.6, 0, 1);
}

/** Amplitude scale of the waves for a sea state: ≈ 0.5 in a calm, 1 in a fresh breeze, 2.6 in a storm. */
export function seaAmp(seaState: number): number {
  return 0.4 + 2.2 * clamp(seaState, 0, 1);
}

/** Name of a sea state for the HUD, from calm to storm (index 0…4). */
export const SEA_NAMES = ['Sakin', 'Hafif', 'Dalgalı', 'Çalkantılı', 'Fırtına'] as const;

export function seaName(seaState: number): (typeof SEA_NAMES)[number] {
  return SEA_NAMES[Math.min(SEA_NAMES.length - 1, Math.floor(clamp(seaState, 0, 1) * SEA_NAMES.length))] ?? SEA_NAMES[0];
}
