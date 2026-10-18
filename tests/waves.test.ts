import { describe, expect, it } from 'vitest';
import { waveHeight } from '../src/render';
import { WAVE_COUNT, chop, waveDirections, waveGlsl } from '../src/render/waves';
import { WAVES, WAVE_TERMS } from '../src/world';

/** Evaluate the emitted GLSL in JS (displacement and height at a rest position), to tie shader and CPU together. */
function evalGlsl(glsl: string, px: number, pz: number, time: number, wind: number, amp: number, dist: number): { dx: number; dz: number; h: number } {
  const block = /vec2 d = uDirs\[(\d+)\];\s*float th = ([\d.]+) \* dot\(p, d\) - ([\d.]+) \* uTime;[\s\S]*?float a = ([\d.]+) \* uAmp \* \(1\.0 - smoothstep\(([\d.]+) \* uFade, ([\d.]+) \* uFade, dist\)\);/g;
  const dirs = waveDirections(wind);
  const g = chop(amp);
  let h = 0;
  let dx = 0;
  let dz = 0;
  let terms = 0;
  for (const m of glsl.matchAll(block)) {
    terms++;
    const [i, k, omega, a0, e0, e1] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number, number];
    const x = Math.min(Math.max((dist - e0) / (e1 - e0), 0), 1);
    const fade = 1 - x * x * (3 - 2 * x); // uFade = 1
    const [ux, uz] = dirs[i] as [number, number];
    const th = k * (px * ux + pz * uz) - omega * time;
    const a = a0 * amp * fade;
    h += a * Math.sin(th);
    dx += g * a * Math.cos(th) * ux;
    dz += g * a * Math.cos(th) * uz;
  }
  expect(terms).toBe(WAVE_COUNT);
  return { dx, dz, h };
}

describe('waveGlsl', () => {
  it('moves rest points to places where the CPU surface has the same height', () => {
    const glsl = waveGlsl();
    for (let i = 0; i < 60; i++) {
      const [px, pz, t, wind, amp] = [i * 7.3 - 120, i * -4.1 + 60, i * 0.9, 1 + i * 0.05, 0.5 + (i % 6) * 0.4];
      const s = evalGlsl(glsl, px, pz, t, wind, amp, 0);
      // GLSL constants are printed with 6 decimals, hence the tolerance; a sign or direction mismatch is off by metres.
      expect(waveHeight(px + s.dx, pz + s.dz, t, wind, amp)).toBeCloseTo(s.h, 2);
    }
  });

  it('fades every wave out with distance, the short ones first, and keeps near water at full strength', () => {
    const glsl = waveGlsl();
    expect(glsl.match(/smoothstep\(/g)).toHaveLength(WAVES.length);
    expect(glsl).toContain('oceanWaves(vec2 p, float dist');
    for (const u of ['uTime', 'uAmp', 'uChop', 'uFade', 'uDirs']) expect(glsl).toContain(u);
    const near = evalGlsl(glsl, 3, 4, 2, 1, 1, 0);
    const far = evalGlsl(glsl, 3, 4, 2, 1, 1, 100000);
    expect(Math.abs(near.h)).toBeGreaterThan(0);
    expect(far).toEqual({ dx: 0, dz: 0, h: 0 });
    expect(WAVE_TERMS).toHaveLength(WAVE_COUNT);
  });
});
