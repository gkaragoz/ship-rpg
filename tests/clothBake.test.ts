import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { SHIP_SPECS, createDeck, type ShipModelMeta } from '../src/ships';
import type { ShipAsset } from '../src/ships/assets';
import {
  bakeFlutter,
  bakeSample,
  clearClothBake,
  clothBakeReady,
  clothBakeUniforms,
  installClothBake,
  type BakeMeta,
} from '../src/ships/clothBake';
import { clothShaderSource } from '../src/ships/clothShader';
import { flagShaderSource } from '../src/ships/flagCloth';
import { createGlbShip } from '../src/ships/glbShip';
import { createShip } from '../src/ships';
import { FLAG_FIRST, FOLD_LAYER, FRAMES, GRID_H, GRID_W, LAYERS, buildBake, buildBakeTexels, fromHalf, hashBake, toHalf } from '../tools/cloth/solver';
import { isCloth } from './clothUtil';
import { loadGlbScene } from './glbScene';

/**
 * The shared flutter bake: `tools/cloth/solver.ts` is deterministic, `public/models/cloth/flutter.bin` is what it
 * writes, the loops are seamless, and the CPU reference sampler follows the GLSL.
 */
const url = (rel: string): URL => new URL(`../public/models/cloth/${rel}`, import.meta.url);
const meta = JSON.parse(new TextDecoder().decode(readFileSync(url('flutter.meta.json')))) as BakeMeta & { bytes: number };
const bytes = readFileSync(url('flutter.bin'));
const file = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

describe('the bake', () => {
  it('is deterministic: the solver writes the same bytes every time, and they are the shipped file', () => {
    const a = buildBake();
    const b = buildBake();
    expect(hashBake(a)).toBe(hashBake(b));
    expect(a).toEqual(b);
    expect(a.length).toBe(file.length);
    expect(hashBake(file)).toBe(meta.hash); // run `npm run bake:cloth` when this fails after changing the solver
    expect(a).toEqual(file);
    expect(bytes.byteLength).toBe(meta.bytes);
    expect(bytes.byteLength).toBeLessThan(500_000);
  });

  it('has the layout the shaders hard-code', () => {
    expect(meta.width).toBe(GRID_W);
    expect(meta.height).toBe(GRID_H);
    expect(meta.frames).toBe(FRAMES);
    expect(meta.layers).toBe(LAYERS);
    expect(meta.foldLayer).toBe(FOLD_LAYER);
    expect(meta.flagFirst).toBe(FLAG_FIRST);
    expect(clothShaderSource).toContain('bakeAt(192.0');
    expect(clothShaderSource).toContain('vec2(15.0, 11.0)');
    expect(clothShaderSource).toContain('vec2(16.0, 12.0)');
    expect(flagShaderSource).toContain('193.0 + f0');
    expect(flagShaderSource).toContain(`${FLAG_FIRST + FRAMES}.0 + f0`);
    expect(meta.layers).toBe(meta.foldLayer + 1 + 2 * meta.frames);
  });

  it('is finite, pinned at the sail edges and within its peak amplitudes', () => {
    const t = buildBakeTexels();
    const per = GRID_W * GRID_H * 4;
    for (const v of t) expect(Number.isFinite(v)).toBe(true);
    for (let layer = 0; layer < FOLD_LAYER; layer++) {
      let peak = 0;
      for (let j = 0; j < GRID_H; j++) {
        for (let i = 0; i < GRID_W; i++) {
          const z = t[layer * per + (j * GRID_W + i) * 4] as number;
          peak = Math.max(peak, Math.abs(z));
          if (i === 0 || j === 0 || i === GRID_W - 1 || j === GRID_H - 1) expect(z).toBe(0); // pinned edges
        }
      }
      expect(peak).toBeLessThanOrEqual(0.0201);
    }
  });

  it('loops seamlessly: the step from the last frame to the first is as small as any other', () => {
    const t = buildBakeTexels();
    const per = GRID_W * GRID_H * 4;
    const rms = (a: number, b: number): number => {
      let s = 0;
      for (let k = 0; k < per; k += 4) s += ((t[a * per + k] as number) - (t[b * per + k] as number)) ** 2;
      return Math.sqrt(s / (per / 4));
    };
    const fields = [...Array.from({ length: 6 }, (_, i) => i * FRAMES), FLAG_FIRST, FLAG_FIRST + FRAMES];
    for (const base of fields) {
      let maxStep = 0;
      for (let f = 0; f < FRAMES - 1; f++) maxStep = Math.max(maxStep, rms(base + f, base + f + 1));
      expect(rms(base + FRAMES - 1, base), `field at layer ${base}`).toBeLessThan(1.6 * maxStep);
    }
  });

  it('round-trips through binary16', () => {
    for (const x of [0, 1, -1, 0.0123, -0.5, 3.25, 1e-5, 65000]) expect(Math.abs(fromHalf(toHalf(x)) - x)).toBeLessThanOrEqual(Math.abs(x) * 1e-3 + 1e-7);
  });
});

describe('the CPU reference sampler', () => {
  const m = meta;
  const n = m.frames;
  const at = (layer: number, i: number, j: number, c = 0): number => fromHalf(file[layer * GRID_W * GRID_H * 4 + (j * GRID_W + i) * 4 + c] as number);

  it('hits the grid nodes exactly and blends between them linearly', () => {
    const out: [number, number, number] = [0, 0, 0];
    bakeSample(m, file, 40, 5 / (GRID_W - 1), 3 / (GRID_H - 1), out);
    expect(out[0]).toBeCloseTo(at(40, 5, 3), 6);
    expect(out[1]).toBeCloseTo(at(40, 5, 3, 1), 6);
    bakeSample(m, file, 40, 5.5 / (GRID_W - 1), 3 / (GRID_H - 1), out);
    expect(out[0]).toBeCloseTo((at(40, 5, 3) + at(40, 6, 3)) / 2, 6);
    bakeSample(m, file, 40, 1.5, -2, out); // clamped
    expect(out[0]).toBeCloseTo(at(40, GRID_W - 1, 0), 6);
  });

  it('follows the shader: amplitude levels blended by flutter, frames by the fractional frame, loop wrapping', () => {
    const band = 1;
    const s0: [number, number, number] = [0, 0, 0];
    const s1: [number, number, number] = [0, 0, 0];
    const u = 0.43;
    const v = 0.61;
    // flutter 0.4 is all the gentle level, 1.0 all the strong one
    expect(bakeFlutter(m, file, band, 0.4, 7, u, v)[0]).toBeCloseTo((bakeSample(m, file, band * 2 * n + 7, u, v, s0), s0[0]), 6);
    expect(bakeFlutter(m, file, band, 1.0, 7, u, v)[0]).toBeCloseTo((bakeSample(m, file, band * 2 * n + n + 7, u, v, s0), s0[0]), 6);
    // half way between two frames
    bakeSample(m, file, band * 2 * n + n + 7, u, v, s0);
    bakeSample(m, file, band * 2 * n + n + 8, u, v, s1);
    expect(bakeFlutter(m, file, band, 1.0, 7.5, u, v)[0]).toBeCloseTo((s0[0] + s1[0]) / 2, 6);
    // phase wraps like the shader's mod(): frame n is frame 0, negative phases count back
    expect(bakeFlutter(m, file, band, 0.8, n + 3.25, u, v)[0]).toBeCloseTo(bakeFlutter(m, file, band, 0.8, 3.25, u, v)[0], 6);
    expect(bakeFlutter(m, file, band, 0.8, -1, u, v)[0]).toBeCloseTo(bakeFlutter(m, file, band, 0.8, n - 1, u, v)[0], 6);
    // no flutter, no motion
    expect(bakeFlutter(m, file, band, 0, 5, u, v)).toEqual([0, 0, 0]);
    // in between the two levels the result is their mix
    const mid = bakeFlutter(m, file, band, 0.7, 4, u, v)[0];
    const lo = bakeFlutter(m, file, band, 0.4, 4, u, v)[0];
    const hi = bakeFlutter(m, file, band, 1.0, 4, u, v)[0];
    expect(mid).toBeCloseTo(lo * 0.5 + hi * 0.5, 6);
  });
});

describe('installing the bake', () => {
  afterEach(() => clearClothBake());
  const SHIPS = SHIP_SPECS.map((s) => s.id);

  it('switches the shared uniforms on and off; the cloth keeps working either way (analytic fallback)', () => {
    expect(clothBakeReady()).toBe(false);
    const tex = clothBakeUniforms.uBake.value;
    installClothBake(meta, file as Uint16Array<ArrayBuffer>);
    expect(clothBakeReady()).toBe(true);
    expect(clothBakeUniforms.uBake.value).not.toBe(tex);
    expect(clothBakeUniforms.uBake.value.image.depth).toBe(meta.layers);
    expect(clothBakeUniforms.uBake.value.type).toBe(THREE.HalfFloatType);
    expect(clothBakeUniforms.uBakeInfo.value.w).toBe(meta.frames);
    clearClothBake();
    expect(clothBakeReady()).toBe(false);
    const ship = createShip(SHIP_SPECS[0]!);
    ship.setSailTrim(1, 1);
    ship.dispose();
  });

  it('does not grow the number of GL programs: every ship of every kind uses the same few cache keys', async () => {
    const keys = new Set<string>();
    const add = (m: THREE.Material | THREE.Material[]): void => {
      if (Array.isArray(m) || !isCloth(m)) return;
      keys.add(m.customProgramCacheKey());
    };
    for (const spec of SHIP_SPECS) {
      const meta2 = JSON.parse(new TextDecoder().decode(readFileSync(new URL(`../public/models/ships/${spec.id}.meta.json`, import.meta.url)))) as ShipModelMeta;
      const asset: ShipAsset = { id: spec.id, scene: await loadGlbScene(`ships/${spec.id}.glb`), meta: meta2, deck: createDeck(meta2) };
      for (const ship of [createGlbShip(spec, asset), createShip(spec)]) {
        ship.root.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          add(o.material as THREE.Material);
          if (o.customDepthMaterial) add(o.customDepthMaterial);
        });
        ship.dispose();
      }
    }
    expect(SHIPS).toHaveLength(16);
    // sail + yards + jib share one key; plus the sail depth, lit flag, unlit flag and flag depth materials
    expect([...keys].sort()).toEqual(['cloth-flag-2', 'cloth-flag-depth-2', 'cloth-flag-lit-2', 'cloth-sail-2', 'cloth-sail-2-depth']);
  });
});
