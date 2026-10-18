import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  FURL_RATE,
  createClothState,
  furlTargets,
  springAngleStep,
  springStep,
  stepCloth,
  type ClothInput,
  type ClothState,
} from '../src/ships/clothState';
import { clothShaderSource, createClothDepthMaterial, createClothUniforms, patchSailMaterial, SAIL_PROGRAM_KEY } from '../src/ships/clothShader';
import { createFlagDepthMaterial, flagShaderSource, flagStrip, patchFlagMaterial, prepareFlag } from '../src/ships/flagCloth';

const input = (over: Partial<ClothInput> = {}): ClothInput => ({
  windRel: 1.2,
  level: 1,
  wind: { angle: 1.2, speed: 9, gust: 1 },
  tear: 0,
  ...over,
});

/** Run `seconds` at `dt`, calling `each` after every step. */
function run(s: ClothState, i: ClothInput, seconds: number, dt: number, each?: (t: number) => void): void {
  for (let t = 0; t < seconds; t += dt) {
    stepCloth(s, i, dt);
    each?.(t + dt);
  }
}

describe('springs', () => {
  it('reach the target without overshooting from rest and stay finite for any dt', () => {
    for (const dt of [0, 1e-9, 1 / 240, 1 / 60, 0.5, 3, 100, 1e6]) {
      const s = { x: 0, v: 0 };
      let peak = 0;
      for (let i = 0; i < 400; i++) {
        springStep(s, 1, 4, dt);
        peak = Math.max(peak, s.x);
        expect(Number.isFinite(s.x) && Number.isFinite(s.v)).toBe(true);
      }
      expect(peak).toBeLessThanOrEqual(1 + 1e-9);
      if (dt >= 1 / 60) expect(s.x).toBeCloseTo(1, 3);
    }
  });

  it('is frame-rate independent: one big step equals many small ones', () => {
    const a = { x: 0, v: 0 };
    const b = { x: 0, v: 0 };
    springStep(a, 1, 3, 1);
    for (let i = 0; i < 100; i++) springStep(b, 1, 3, 0.01);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.v).toBeCloseTo(b.v, 6);
  });

  it('takes angles the short way round', () => {
    const s = { x: 3.0, v: 0 };
    springAngleStep(s, -3.0, 5, 0.1); // −3 is 0.28 rad past π: the short way goes up
    expect(s.x).toBeGreaterThan(3.0);
    for (let i = 0; i < 200; i++) springAngleStep(s, -3.0, 5, 0.1);
    expect(Math.cos(s.x)).toBeCloseTo(Math.cos(-3.0), 3);
  });
});

describe('furl targets', () => {
  it('gather the lowest tier first and the top one last', () => {
    const out = [0, 0, 0];
    furlTargets(1, 3, out);
    expect(out).toEqual([0, 0, 0]);
    furlTargets(0, 3, out);
    expect(out).toEqual([1, 1, 1]);
    for (let l = 0; l <= 1; l += 0.05) {
      furlTargets(l, 3, out);
      expect(out[0]).toBeGreaterThanOrEqual(out[1] as number);
      expect(out[1]).toBeGreaterThanOrEqual(out[2] as number);
    }
    furlTargets(0.5, 3, out);
    expect(out[0]).toBe(1);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[2]).toBe(0);
  });

  it('leaves unused slots open for a ship with fewer tiers', () => {
    const out = [9, 9, 9];
    furlTargets(0, 2, out);
    expect(out).toEqual([1, 1, 0]);
  });
});

describe('stepCloth', () => {
  it('snaps to the trim on the first step instead of animating from nothing', () => {
    const s = createClothState(3);
    stepCloth(s, input({ level: 0.2 }), 0.016);
    expect(s.furl[0]?.x).toBe(1);
    expect(s.brace.x).toBeGreaterThan(0.4);
    expect(s.belly.x).toBeGreaterThan(0.5);
  });

  it('furls tier by tier from the bottom, finishing with every tier gathered', () => {
    const s = createClothState(3);
    stepCloth(s, input(), 0.016);
    const first = [Infinity, Infinity, Infinity];
    run(s, input({ level: 0 }), 8, 1 / 60, (t) => {
      s.raw.forEach((r, k) => {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
        if (k > 0) expect(r).toBeLessThanOrEqual((s.raw[k - 1] as number) + 1e-9); // never a lower tier more open than the one above
        if (r > 0.02 && first[k] === Infinity) first[k] = t;
      });
    });
    expect(first[0]).toBeLessThan(first[1] as number);
    expect(first[1]).toBeLessThan(first[2] as number);
    expect(s.furl.every((f) => f.x > 0.99)).toBe(true);
    // a tier needs about 1/FURL_RATE seconds and the next one starts when it is nearly half done
    expect(first[2]).toBeGreaterThan(0.5 / FURL_RATE);
  });

  it('sets sail from the top tier down', () => {
    const s = createClothState(3);
    stepCloth(s, input({ level: 0 }), 0.016);
    const first = [Infinity, Infinity, Infinity];
    run(s, input({ level: 1 }), 8, 1 / 60, (t) => {
      s.raw.forEach((r, k) => {
        if (r < 0.98 && first[k] === Infinity) first[k] = t;
      });
    });
    expect(first[2]).toBeLessThan(first[1] as number);
    expect(first[1]).toBeLessThan(first[0] as number);
    expect(s.furl.every((f) => f.x < 0.01)).toBe(true);
  });

  it('stays finite and in bounds for any dt, level, wind and damage', () => {
    let seed = 12345;
    const rnd = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (const dt of [0, 1e-6, 1 / 144, 1 / 60, 0.1, 1, 30, 1e4]) {
      const s = createClothState(1 + Math.floor(rnd() * 3));
      for (let n = 0; n < 300; n++) {
        const a = (rnd() - 0.5) * 2 * Math.PI;
        stepCloth(s, { windRel: a, level: rnd() * 1.4 - 0.2, wind: { angle: a + rnd() - 0.5, speed: rnd() * 40, gust: 0.75 + rnd() * 0.5 }, tear: rnd() }, dt);
        const values = [...s.raw, ...s.furl.map((f) => f.x), s.furlAft.x, s.belly.x, s.bellyAft.x, s.flutter.x, s.flutterAft.x, s.brace.x, s.sheet.x, s.flagAngle.x, s.flagSpeed.x, s.flagGust.x];
        for (const v of values) expect(Number.isFinite(v)).toBe(true);
        for (const r of s.raw) expect(r >= 0 && r <= 1).toBe(true);
        for (const f of s.furl) {
          expect(f.x).toBeGreaterThan(-0.2);
          expect(f.x).toBeLessThan(1.2);
        }
        expect(Math.abs(s.belly.x)).toBeLessThan(1.3);
        expect(Math.abs(s.bellyAft.x)).toBeLessThan(1.3);
        expect(s.flutter.x).toBeLessThan(1.5);
      }
    }
  });

  it('never flips the belly in one step when the wind crosses the bow, and empties it on the way', () => {
    const s = createClothState(2);
    stepCloth(s, input({ windRel: 1.2, wind: { angle: 1.2, speed: 9, gust: 1 } }), 0.016);
    const start = s.bellyAft.x;
    expect(start).toBeGreaterThan(0.5);
    let prev = start;
    let minAbs = Infinity;
    run(s, input({ windRel: -1.2, wind: { angle: -1.2, speed: 9, gust: 1 } }), 6, 1 / 60, () => {
      expect(Math.abs(s.bellyAft.x - prev)).toBeLessThan(0.06);
      prev = s.bellyAft.x;
      minAbs = Math.min(minAbs, Math.abs(s.bellyAft.x));
    });
    expect(minAbs).toBeLessThan(0.1);
    expect(s.bellyAft.x).toBeLessThan(-0.5);
    expect(s.belly.x).toBeGreaterThanOrEqual(0); // square sails are never backed through the mast
  });

  it('flutters in irons and in a gale, much less on a reach', () => {
    const at = (angle: number, speed: number, gust = 1): number => {
      const s = createClothState(2);
      stepCloth(s, input({ windRel: angle, wind: { angle, speed, gust } }), 0.016);
      return s.flutter.x;
    };
    expect(at(0.1, 8)).toBeGreaterThan(0.8);
    expect(at(1.5, 8)).toBeLessThan(0.3);
    expect(at(1.5, 25)).toBeGreaterThan(at(1.5, 8) + 0.2);
    expect(at(1.5, 8, 1.25)).toBeGreaterThan(at(1.5, 8, 1));
  });

  it('tears: damage adds flutter', () => {
    const a = createClothState(2);
    const b = createClothState(2);
    stepCloth(a, input(), 0.016);
    stepCloth(b, input({ tear: 1 }), 0.016);
    expect(b.flutter.x).toBeGreaterThan(a.flutter.x + 0.3);
  });
});

/** The uniform names a GLSL source declares. */
const declared = (source: string): string[] => [...source.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1] as string);

type FakeShader = { uniforms: Record<string, THREE.IUniform>; vertexShader: string };
const compileHook = (m: THREE.Material, vertexShader: string): FakeShader => {
  const shader: FakeShader = { uniforms: {}, vertexShader };
  m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
};

describe('cloth uniforms', () => {
  it('start open, filled, calm: a ship nobody trims (the gallery) shows full sails', () => {
    const u = createClothUniforms();
    expect(u.furl.value.toArray()).toEqual([0, 0, 0, 0]); // Vector4() alone would be (0, 0, 0, 1): fore-and-aft sails furled
    expect(u.flutter.value.toArray()).toEqual([0, 0]);
    expect(u.tear.value).toBe(0);
    expect(u.detail.value).toBe(1);
  });
});

describe('cloth shader contract', () => {
  it('hooks into the chunks three.js really has', () => {
    for (const lib of [THREE.ShaderLib.standard, THREE.ShaderLib.physical]) {
      for (const chunk of ['common', 'beginnormal_vertex', 'begin_vertex']) expect(lib.vertexShader).toContain(`#include <${chunk}>`);
    }
    for (const lib of [THREE.ShaderLib.depth, THREE.ShaderLib.basic]) {
      for (const chunk of ['common', 'begin_vertex']) expect(lib.vertexShader).toContain(`#include <${chunk}>`);
    }
  });

  it('patches a sail material: shared program, per-ship uniforms, deformed position and normal', () => {
    const a = createClothUniforms();
    const b = createClothUniforms();
    const ma = new THREE.MeshStandardMaterial();
    const mb = new THREE.MeshStandardMaterial();
    patchSailMaterial(ma, a);
    patchSailMaterial(mb, b);
    expect(ma.customProgramCacheKey()).toBe(mb.customProgramCacheKey());
    expect(ma.customProgramCacheKey()).toBe(SAIL_PROGRAM_KEY);

    const shaderA = compileHook(ma, THREE.ShaderLib.standard.vertexShader);
    const shaderB = compileHook(mb, THREE.ShaderLib.standard.vertexShader);
    expect(shaderA.vertexShader).toContain('clothDeform(clothP, objectNormal)');
    expect(shaderA.vertexShader).toContain('vec3 transformed = clothP;');
    expect(shaderA.vertexShader).not.toContain('vec3 transformed = vec3( position )');
    expect(shaderA.vertexShader).toBe(shaderB.vertexShader); // identical source: one GL program for every ship
    expect(shaderA.uniforms.uFurl).toBe(a.furl); // but each ship's own uniform objects
    expect(shaderB.uniforms.uFurl).toBe(b.furl);
    for (const name of declared(clothShaderSource)) expect(shaderA.uniforms[name], name).toBeDefined();
  });

  it('gives the shadow the same displacement through a depth material', () => {
    const u = createClothUniforms();
    const depth = createClothDepthMaterial(u);
    expect(depth.depthPacking).toBe(THREE.RGBADepthPacking);
    const shader = compileHook(depth, THREE.ShaderLib.depth.vertexShader);
    expect(shader.vertexShader).toContain('clothDeform(transformed, clothN)');
    for (const name of declared(clothShaderSource)) expect(shader.uniforms[name], name).toBeDefined();
    expect(shader.uniforms.uFurl).toBe(u.furl);
  });

  it('has balanced braces and declares every attribute it reads', () => {
    for (const src of [clothShaderSource, flagShaderSource]) {
      expect(src.split('{').length).toBe(src.split('}').length);
      expect(src.split('(').length).toBe(src.split(')').length);
    }
    expect(clothShaderSource).toMatch(/attribute vec4 clothA;/);
    expect(clothShaderSource).toMatch(/attribute vec4 clothB;/);
    expect(flagShaderSource).toMatch(/attribute vec4 flagA;/);
    expect(flagShaderSource).toMatch(/attribute vec3 flagP;/);
  });

  it('patches flag materials (lit and unlit) and their shadow', () => {
    const u = createClothUniforms();
    const lit = new THREE.MeshStandardMaterial();
    const unlit = new THREE.MeshBasicMaterial();
    patchFlagMaterial(lit, u, true);
    patchFlagMaterial(unlit, u, false);
    expect(lit.customProgramCacheKey()).not.toBe(unlit.customProgramCacheKey());
    const shaders = [
      compileHook(lit, THREE.ShaderLib.standard.vertexShader),
      compileHook(unlit, THREE.ShaderLib.basic.vertexShader),
      compileHook(createFlagDepthMaterial(u), THREE.ShaderLib.depth.vertexShader),
    ];
    for (const sh of shaders) {
      expect(sh.vertexShader).toContain('flagDeform(');
      expect(sh.uniforms.uWind).toBe(u.wind);
      for (const name of declared(flagShaderSource)) expect(sh.uniforms[name], name).toBeDefined();
    }
  });
});

describe('flagStrip', () => {
  it('builds a pole-anchored strip the shader can parametrise', () => {
    const g = flagStrip(3, 1, 0.5);
    expect(prepareFlag(g, 0.3)).toBe(1);
    const a = g.getAttribute('flagA');
    const pos = g.getAttribute('position');
    let tip = 0;
    for (let i = 0; i < a.count; i++) {
      expect(a.getX(i)).toBeCloseTo(-pos.getX(i), 6); // s: metres from the pole (x = 0) along the cloth
      expect(a.getY(i)).toBeCloseTo(-pos.getY(i), 6);
      expect(a.getZ(i)).toBeCloseTo(3, 6);
      tip = Math.max(tip, a.getX(i));
    }
    expect(tip).toBeCloseTo(3, 6);
  });
});
