/**
 * Ocean surface as a sum of travelling sines. The same definition drives the vertex
 * shader (via `waveGlsl`) and the CPU (`waveHeight`), so ships ride the visible waves.
 */
export interface WaveSpec {
  /** Direction offset from the wind's travel direction, radians. */
  dir: number;
  /** Wavelength in metres. */
  length: number;
  /** Amplitude in metres at amplitude scale 1. */
  amplitude: number;
}

export const WAVES: readonly WaveSpec[] = [
  { dir: 0, length: 60, amplitude: 0.55 },
  { dir: 0.5, length: 35, amplitude: 0.3 },
  { dir: -0.6, length: 22, amplitude: 0.18 },
  { dir: 1.1, length: 13, amplitude: 0.09 },
];

const GRAVITY = 9.81;

/** Deep-water wave number and phase speed for a wavelength. */
const wave = (length: number): { k: number; omega: number } => {
  const k = (2 * Math.PI) / length;
  return { k, omega: k * Math.sqrt(GRAVITY / k) };
};

/** Surface height (m) at world (x, z); `windFrom` is the wind's origin angle (see core/views). */
export function waveHeight(x: number, z: number, time: number, windFrom: number, ampScale = 1): number {
  let h = 0;
  for (const w of WAVES) {
    const { k, omega } = wave(w.length);
    const a = windFrom + Math.PI + w.dir;
    h += w.amplitude * Math.sin(k * (Math.cos(a) * x - Math.sin(a) * z) - omega * time);
  }
  return h * ampScale;
}

/** Waves shorter than this fade out with distance (`lod`) so far water does not shimmer. */
const SHORT_WAVE = 50;

/**
 * GLSL `float oceanHeight(vec2 p, float lod)` matching `waveHeight` at lod = 1; needs
 * uniforms uTime, uWind, uAmp. `lod` (1 near, 0 far) scales the short waves.
 */
export function waveGlsl(): string {
  const f = (n: number): string => n.toFixed(6);
  const terms = WAVES.map((w) => {
    const { k, omega } = wave(w.length);
    const a = `uWind + ${f(Math.PI + w.dir)}`;
    const fade = w.length < SHORT_WAVE ? ' * lod' : '';
    return `  h += ${f(w.amplitude)} * sin(${f(k)} * dot(p, vec2(cos(${a}), -sin(${a}))) - ${f(omega)} * uTime)${fade};`;
  });
  return `float oceanHeight(vec2 p, float lod) {\n  float h = 0.0;\n${terms.join('\n')}\n  return h * uAmp;\n}`;
}
