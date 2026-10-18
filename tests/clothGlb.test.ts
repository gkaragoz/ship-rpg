import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { SHIP_SPECS, createDeck, type ShipModelMeta } from '../src/ships';
import type { ShipAsset } from '../src/ships/assets';
import { prepareSail } from '../src/ships/clothGeometry';
import { prepareYards } from '../src/ships/clothYards';
import { clothClock } from '../src/ships/clothState';
import { prepareFlag } from '../src/ships/flagCloth';
import { createGlbShip } from '../src/ships/glbShip';
import { loadGlbScene } from './glbScene';
import { gatheredXY } from './clothReference';
import { isCloth, uniformsOf } from './clothUtil';

/**
 * The cloth shaders rely on attributes derived at load time from the shipped Blender meshes: tiers from the connected
 * grids, belly from the boundary plane, flag poles from the strips. These tests run that on all 16 GLBs, no WebGL.
 */
const meshes = (root: THREE.Object3D, re: RegExp): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && re.test(o.name)) out.push(o);
  });
  return out;
};
const mastOf = (mesh: THREE.Mesh): number => Number(/_m(\d+)_/.exec(mesh.name)?.[1]);

describe.each(SHIP_SPECS.map((s) => [s.id, s] as const))('cloth analysis of the %s GLB', (id, spec) => {
  it('finds every tier of every square sail, with sane per-vertex attributes', async () => {
    const root = await loadGlbScene(`ships/${id}.glb`);
    const squares = meshes(root, /^LOD0_m\d+_SquareSail$/);
    const expected = spec.masts.filter((m) => m.rig === 'square');
    expect(squares).toHaveLength(expected.length);
    for (const mesh of squares) {
      const mast = spec.masts[mastOf(mesh)];
      const tiers = mast?.tiers ?? 2;
      const analysis = prepareSail(mesh.geometry, 'square', 0.5, 0);
      expect(analysis?.tiers, mesh.name).toHaveLength(tiers);
      const t = analysis?.tiers ?? [];
      for (let k = 0; k < t.length; k++) {
        expect((t[k] as { yTop: number; yBot: number }).yTop).toBeGreaterThan((t[k] as { yBot: number }).yBot);
        if (k > 0) expect((t[k - 1] as { yTop: number }).yTop).toBeLessThan((t[k] as { yBot: number }).yBot); // tiers do not overlap
      }
      const A = mesh.geometry.getAttribute('clothA');
      const B = mesh.geometry.getAttribute('clothB');
      expect(A.count).toBe(mesh.geometry.getAttribute('position').count);
      const codes = new Set<number>();
      let maxBelly = 0;
      for (let i = 0; i < A.count; i++) {
        for (const c of [A.getX(i), A.getY(i), A.getZ(i), A.getW(i), B.getX(i), B.getY(i), B.getZ(i), B.getW(i)]) expect(Number.isFinite(c)).toBe(true);
        codes.add(A.getX(i));
        expect(A.getY(i)).toBeGreaterThanOrEqual(0);
        expect(A.getY(i)).toBeLessThanOrEqual(1);
        expect(A.getZ(i)).toBeGreaterThanOrEqual(-1e-6);
        expect(A.getZ(i)).toBeLessThanOrEqual(1 + 1e-6);
        expect(B.getY(i)).toBeGreaterThan(0.5); // the tier is a real sail, not a sliver
        maxBelly = Math.max(maxBelly, A.getW(i));
        expect(Math.abs(A.getW(i))).toBeLessThan(0.2 * B.getZ(i)); // the baked billow is a fraction of the width
      }
      expect([...codes].sort()).toEqual(Array.from({ length: tiers }, (_, k) => k + 1));
      expect(maxBelly).toBeGreaterThan(0.05); // the baked belly bulges forward
    }
  });

  it('assigns the yards, footropes and boltropes to their tier', async () => {
    const root = await loadGlbScene(`ships/${id}.glb`);
    for (const sail of meshes(root, /^LOD0_m\d+_SquareSail$/)) {
      const analysis = prepareSail(sail.geometry, 'square', 0.5, 0);
      const yards = meshes(root, new RegExp(`^LOD0_m${mastOf(sail)}_SquareYards$`))[0];
      expect(yards).toBeDefined();
      if (!yards || !analysis) continue;
      prepareYards(yards.geometry, analysis.tiers, 0.5, 0);
      const A = yards.geometry.getAttribute('clothA');
      const codes = new Set<number>();
      for (let i = 0; i < A.count; i++) codes.add(A.getX(i));
      expect([...codes].sort()).toEqual(analysis.tiers.map((_, k) => 11 + k));
      // every yard sits at the head line of the tier it is assigned to
      const pos = yards.geometry.getAttribute('position');
      const top = new Map<number, number>();
      for (let i = 0; i < A.count; i++) top.set(A.getX(i), Math.max(top.get(A.getX(i)) ?? -Infinity, pos.getY(i)));
      analysis.tiers.forEach((t, k) => expect(top.get(11 + k) ?? 0).toBeGreaterThan(t.yTop - 0.05));
    }
    for (const aft of meshes(root, /^LOD0_m\d+_AftSail$/)) {
      const analysis = prepareSail(aft.geometry, 'aft', 0.5, 0);
      expect(analysis?.tiers).toHaveLength(1);
      const A = aft.geometry.getAttribute('clothA');
      const B = aft.geometry.getAttribute('clothB');
      let thin = 0;
      for (let i = 0; i < A.count; i++) {
        expect(A.getX(i)).toBe(4);
        expect(A.getY(i)).toBeGreaterThanOrEqual(0);
        expect(A.getY(i)).toBeLessThanOrEqual(1 + 1e-6);
        if (B.getY(i) < 0.05) thin++;
      }
      expect(thin).toBeLessThan(A.count * 0.1);
    }
  });

  it('derives pole, length and distance along the cloth for every pennant and the ensign', async () => {
    const root = await loadGlbScene(`ships/${id}.glb`);
    const flag = meshes(root, /^LOD0_Flag$/)[0];
    expect(flag).toBeDefined();
    if (!flag) return;
    const strips = prepareFlag(flag.geometry);
    expect(strips).toBeGreaterThanOrEqual(2); // a pennant and the stern ensign at least
    const A = flag.geometry.getAttribute('flagA');
    const P = flag.geometry.getAttribute('flagP');
    const pos = flag.geometry.getAttribute('position');
    let root0 = 0;
    for (let i = 0; i < A.count; i++) {
      expect(A.getX(i)).toBeGreaterThanOrEqual(-1e-4);
      expect(A.getX(i)).toBeLessThanOrEqual(A.getZ(i) + 1e-4);
      expect(A.getZ(i)).toBeGreaterThan(0.5);
      expect(A.getY(i)).toBeGreaterThanOrEqual(-0.05); // nothing (but a hair of wave) above the top of the pole end
      expect(P.getX(i) - A.getX(i)).toBeCloseTo(pos.getX(i), 3);
      if (A.getX(i) < 1e-3) root0++;
    }
    expect(root0).toBeGreaterThanOrEqual(strips * 2);
  });
});

describe('createGlbShip with the cloth shaders', () => {
  const read = <T>(rel: string): T => JSON.parse(new TextDecoder().decode(readFileSync(new URL(`../public/models/${rel}`, import.meta.url)))) as T;
  let t = 0;
  beforeEach(() => {
    t = 0;
    clothClock.now = () => t;
  });

  const build = async (id: string): Promise<{ asset: ShipAsset; spec: (typeof SHIP_SPECS)[number] }> => {
    const spec = SHIP_SPECS.find((s) => s.id === id);
    if (!spec) throw new Error(id);
    const meta = read<ShipModelMeta>(`ships/${id}.meta.json`);
    return { asset: { id, scene: await loadGlbScene(`ships/${id}.glb`), meta, deck: createDeck(meta) }, spec };
  };

  it('moves the sails of every level in the shader (pivots only swing), per ship, sharing one program', async () => {
    const { asset, spec } = await build('brig');
    const a = createGlbShip(spec, asset);
    const b = createGlbShip(spec, asset);
    const pivots = (s: typeof a, lod: number): THREE.Object3D[] => meshes(s.root, new RegExp(`^LOD${lod}_m[0-9]+_SquareSail$`)).map((m) => m.parent as THREE.Object3D);
    for (let i = 0; i < 30; i++) {
      t += 0.5;
      a.setSailTrim(1.0, 0); // furled
      b.setSailTrim(1.0, 1);
    }
    for (const lod of [0, 1, 2]) {
      expect(pivots(a, lod).length).toBeGreaterThan(0);
      for (const p of pivots(a, lod)) {
        expect(p.scale.y).toBe(1); // not squashed: the cloth gathers up to its yards instead, at every level
        expect(p.visible).toBe(true);
        expect(p.rotation.y).toBeGreaterThan(0.3); // still braced
      }
    }

    const sailMat = (s: typeof a, lod = 0): THREE.MeshStandardMaterial => (meshes(s.root, new RegExp(`^LOD${lod}_m0_SquareSail$`))[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const yardMat = (s: typeof a): THREE.MeshStandardMaterial => (meshes(s.root, /^LOD0_m0_SquareYards$/)[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(sailMat(a)).not.toBe(sailMat(b)); // private materials per ship...
    expect(sailMat(a).customProgramCacheKey()).toBe(sailMat(b).customProgramCacheKey()); // ...sharing one GL program
    expect(yardMat(a)).not.toBe(sailMat(a));
    expect(sailMat(a, 1)).not.toBe(sailMat(a, 0)); // a level has its own detail setting
    const ua = uniformsOf(sailMat(a));
    const ub = uniformsOf(sailMat(b));
    expect(ua.uFurl).not.toBe(ub.uFurl);
    expect(ua.uFurl).toBe(uniformsOf(sailMat(a, 1)).uFurl); // but the levels share furl, belly and tear, so they never pop
    expect(ua.uDetail?.value).toBe(1);
    expect(uniformsOf(sailMat(a, 1)).uDetail?.value).toBe(0);
    expect(uniformsOf(sailMat(a, 2)).uDetail?.value).toBe(0);
    const furlA = ua.uFurl?.value as THREE.Vector4;
    const furlB = ub.uFurl?.value as THREE.Vector4;
    expect(furlA.x).toBeGreaterThan(0.99);
    expect(furlA.z).toBeGreaterThan(0.99);
    expect(furlB.x).toBeLessThan(0.01);

    // the shadow follows the cloth
    expect((meshes(a.root, /^LOD0_m0_SquareSail$/)[0] as THREE.Mesh).customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
    a.dispose();
    b.dispose();
  });

  it('tears the lower part of the cloth and keeps the pristine look at full rigging', async () => {
    const { asset, spec } = await build('frigate');
    const s = createGlbShip(spec, asset);
    const mat = (meshes(s.root, /^LOD0_m0_SquareSail$/)[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const u = uniformsOf(mat);
    s.setSailTrim(1, 1);
    s.setCondition({ rigging: 1, flooding: 0, fire: 0 }, 0);
    expect(u.uTear?.value).toBe(0);
    s.setCondition({ rigging: 0, flooding: 0, fire: 0 }, 0);
    expect(u.uTear?.value).toBe(1);
    s.dispose();
  });

  it('flies the flags in the shader and colours them per nation', async () => {
    const { asset, spec } = await build('galleon');
    const s = createGlbShip(spec, asset, 0x336699);
    const flag = meshes(s.root, /^LOD0_Flag$/)[0] as THREE.Mesh;
    const mat = flag.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHex()).toBe(0x336699);
    expect(flag.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.standard.vertexShader };
    mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    s.setWind?.({ angle: 0.7, speed: 12, gust: 1.1 });
    s.setSailTrim(0.7, 1);
    const w = shader.uniforms.uWind?.value as THREE.Vector4;
    expect(w.x).toBeCloseTo(0.7);
    expect(w.y).toBeCloseTo(12);
    expect(w.z).toBeCloseTo(1.1);
    s.dispose();
  });
});

describe.each(SHIP_SPECS.map((s) => [s.id, s] as const))('cloth coverage of the %s ship', (id, spec) => {
  const read = <T>(rel: string): T => JSON.parse(new TextDecoder().decode(readFileSync(new URL(`../public/models/${rel}`, import.meta.url)))) as T;

  it('builds every sail, jib, yards and boom mesh of every level with a cloth material, and none has a frozen vertex', async () => {
    const meta = read<ShipModelMeta>(`ships/${id}.meta.json`);
    const asset: ShipAsset = { id, scene: await loadGlbScene(`ships/${id}.glb`), meta, deck: createDeck(meta) };
    const ship = createGlbShip(spec, asset);
    const cloth = meshes(ship.root, /(Sail|Jib|SquareYards|AftYards)$/);
    expect(cloth.length).toBeGreaterThan(0);
    const kinds = new Set<string>();
    for (const mesh of cloth) {
      expect(isCloth(mesh.material), mesh.name).toBe(true);
      expect(mesh.customDepthMaterial, mesh.name).toBeInstanceOf(THREE.MeshDepthMaterial);
      kinds.add(/Sail$/.test(mesh.name) ? 'sail' : /Jib$/.test(mesh.name) ? 'jib' : 'yards');
      const g = mesh.geometry;
      const A = g.getAttribute('clothA');
      expect(A, mesh.name).toBeDefined();
      const n = g.getAttribute('position').count;
      const lod = Number(/^LOD(\d)/.exec(mesh.name)?.[1]);
      let frozen = 0;
      let moved = 0;
      for (let v = 0; v < n; v++) {
        const code = A.getX(v);
        expect(code, `${mesh.name} vertex ${v} has no cloth code`).toBeGreaterThan(0);
        const [x, y] = gatheredXY(g, v, 0.8);
        const moves = Math.hypot(x - g.getAttribute('position').getX(v), y - g.getAttribute('position').getY(v)) > 1e-3;
        if (moves) moved++;
        if (code >= 10) continue; // rigging: the yards stay where they are on purpose (checked below for booms)
        const B = g.getAttribute('clothB');
        const head = code < 5 && B.getX(v) - g.getAttribute('position').getY(v) < 0.05; // on the head line (the yard): pinned on purpose
        const tack = code > 4.5 && Math.hypot(g.getAttribute('position').getX(v) - B.getX(v), g.getAttribute('position').getY(v) - B.getY(v)) < 1e-6;
        if (!moves && !head && !tack) frozen++;
      }
      expect(frozen, `${mesh.name} (LOD${lod}) has vertices the shader would leave frozen at furl 0.8`).toBe(0);
      if (/AftYards$/.test(mesh.name)) {
        let low = 0;
        for (let v = 0; v < n; v++) if (A.getY(v) < 0.5) low++;
        if (low > 0) expect(moved, `${mesh.name}: the boom follows the sail`).toBeGreaterThan(0);
      }
    }
    expect(kinds.has('sail')).toBe(true);
    // levels 0 and 1 (and 2) all present
    for (const lod of [0, 1, 2]) expect(cloth.some((m) => m.name.startsWith(`LOD${lod}_`)), `LOD${lod}`).toBe(true);
    ship.dispose();
  });
});
