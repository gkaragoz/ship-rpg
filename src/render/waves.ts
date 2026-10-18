import { WAVES, WAVE_TERMS, chop, waveDirection } from '../world';

export { waveHeight } from '../world';

/** Wave count the shader loops over (the `uDirs` uniform has this many entries). */
export const WAVE_COUNT = WAVES.length;

/** Per-wave travel directions (x, z) for the wind, written into the `uDirs` uniform every frame. */
export function waveDirections(windFrom: number): [number, number][] {
  return WAVES.map((_, i) => waveDirection(i, windFrom));
}

export { chop };

/**
 * GLSL for the Gerstner sum of `world/sea.ts`. Needs uniforms `uTime`, `uAmp`, `uChop` (see `chop`), `uFade`
 * (sea grid / 64: finer meshes keep short waves further out) and `uDirs[WAVE_COUNT]` (see `waveDirections`).
 * `oceanWaves(p, dist, disp, nrm, jac)` gives, for the rest position `p` seen from `dist` metres away, the
 * displacement of the surface point, its unit normal and the Jacobian of the horizontal map (below ~0.7 the
 * crest is pinching: foam). Each wave fades out once the mesh cells there are too coarse to hold it
 * (about a third of its wavelength), so far water stays calm instead of shimmering.
 */
export function waveGlsl(): string {
  const f = (n: number): string => n.toFixed(6);
  const terms = WAVES.map((w, i) => {
    const t = WAVE_TERMS[i];
    if (!t) return '';
    const fade = ` * (1.0 - smoothstep(${f(3.5 * w.length)} * uFade, ${f(8 * w.length)} * uFade, dist))`;
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
  return `void oceanWaves(vec2 p, float dist, out vec3 disp, out vec3 nrm, out float jac) {
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
