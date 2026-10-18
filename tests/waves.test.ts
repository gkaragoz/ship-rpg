import { describe, expect, it } from 'vitest';
import { waveHeight } from '../src/render';
import { WAVES, waveGlsl } from '../src/render/waves';

const MAX = WAVES.reduce((a, w) => a + w.amplitude, 0);

describe('waveHeight', () => {
  it('is deterministic and bounded by the summed amplitudes', () => {
    expect(waveHeight(12, -30, 5, 1.2)).toBe(waveHeight(12, -30, 5, 1.2));
    for (let i = 0; i < 400; i++) {
      const h = waveHeight(i * 3.7, i * -2.3, i * 0.31, 1.57);
      expect(Math.abs(h)).toBeLessThanOrEqual(MAX + 1e-9);
    }
  });

  it('scales with the amplitude factor and moves with time', () => {
    const base = waveHeight(10, 10, 3, 1);
    expect(waveHeight(10, 10, 3, 1, 2)).toBeCloseTo(base * 2);
    expect(waveHeight(10, 10, 4, 1)).not.toBeCloseTo(base);
  });

  it('is calm-neutral on average (no net height offset)', () => {
    let sum = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) sum += waveHeight(i * 1.37, i * 0.73, 2, 0.8);
    expect(Math.abs(sum / n)).toBeLessThan(0.1);
  });
});

/** Evaluate the emitted GLSL terms in JS, to prove shader and CPU waves are the same function. */
function evalGlsl(glsl: string, x: number, z: number, time: number, wind: number, amp: number): number {
  const term =
    /h \+= ([\d.]+) \* sin\(([\d.]+) \* dot\(p, vec2\(cos\(uWind \+ ([\d.]+)\), -sin\(uWind \+ ([\d.]+)\)\)\) - ([\d.]+) \* uTime\)( \* lod)?;/g;
  let h = 0;
  for (const m of glsl.matchAll(term)) {
    const [a, k, phase, , omega] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number];
    const angle = wind + phase;
    h += a * Math.sin(k * (Math.cos(angle) * x - Math.sin(angle) * z) - omega * time);
  }
  return h * amp;
}

describe('waveGlsl', () => {
  it('evaluates to the same heights as waveHeight', () => {
    const glsl = waveGlsl();
    for (let i = 0; i < 50; i++) {
      const [x, z, t, wind, amp] = [i * 7.3 - 120, i * -4.1 + 60, i * 0.9, 1 + i * 0.05, 0.6 + (i % 5) * 0.2];
      // GLSL constants are printed with 6 decimals, hence 3 digits here; a sign or direction
      // mismatch would be off by whole metres.
      expect(evalGlsl(glsl, x, z, t, wind, amp)).toBeCloseTo(waveHeight(x, z, t, wind, amp), 3);
    }
  });

  it('emits one term per wave using the shared uniforms', () => {
    const glsl = waveGlsl();
    expect(glsl).toContain('float oceanHeight(vec2 p, float lod)');
    expect(glsl.match(/h \+= /g)).toHaveLength(WAVES.length);
    expect(glsl).toContain('uTime');
    expect(glsl).toContain('uWind');
    expect(glsl).toContain('uAmp');
  });
});
