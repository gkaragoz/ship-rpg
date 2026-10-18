import { SHORT_WAVE, WAVES, WAVE_TERMS, chop, waveDirection } from '../world';

export { waveHeight } from '../world';

/** Wave count the shader loops over (the `uDirs` uniform has this many entries). */
export const WAVE_COUNT = WAVES.length;

/** Per-wave travel directions (x, z) for the wind, written into the `uDirs` uniform every frame. */
export function waveDirections(windFrom: number): [number, number][] {
  return WAVES.map((_, i) => waveDirection(i, windFrom));
}

export { chop };

/**
 * GLSL for the Gerstner sum of `world/sea.ts`. Needs uniforms `uTime`, `uAmp`, `uChop` (see `chop`) and
 * `uDirs[WAVE_COUNT]` (see `waveDirections`). `oceanWaves(p, lod, disp, nrm, jac)` gives, for the rest position
 * `p`, the displacement of the surface point, its unit normal and the Jacobian of the horizontal map
 * (below ~0.7 the crest is pinching: foam). `lod` (1 near, 0 far) scales the short waves down.
 */
export function waveGlsl(): string {
  const f = (n: number): string => n.toFixed(6);
  const terms = WAVES.map((w, i) => {
    const t = WAVE_TERMS[i];
    if (!t) return '';
    const fade = w.length < SHORT_WAVE ? ' * lod' : '';
    return `  {
    vec2 d = uDirs[${i}];
    float th = ${f(t.k)} * dot(p, d) - ${f(t.omega)} * uTime;
    float s = sin(th);
    float c = cos(th);
    float a = ${f(w.amplitude)} * uAmp${fade};
    float ka = ${f(t.k)} * a;
    h += a * s;
    pull += uChop * a * c * d;
    slope += ka * c * d;
    float sc = uChop * ka * s;
    dxx -= sc * d.x * d.x;
    dxz -= sc * d.x * d.y;
    dzz -= sc * d.y * d.y;
  }`;
  });
  return `void oceanWaves(vec2 p, float lod, out vec3 disp, out vec3 nrm, out float jac) {
  float h = 0.0;
  vec2 pull = vec2(0.0);
  vec2 slope = vec2(0.0);
  float dxx = 0.0;
  float dxz = 0.0;
  float dzz = 0.0;
${terms.join('\n')}
  vec3 tx = vec3(1.0 + dxx, slope.x, dxz);
  vec3 tz = vec3(dxz, slope.y, 1.0 + dzz);
  nrm = normalize(cross(tz, tx));
  jac = (1.0 + dxx) * (1.0 + dzz) - dxz * dxz;
  disp = vec3(pull.x, h, pull.y);
}`;
}
