import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Contract for public/models/props/debris.glb (docs/SHIP_ASSETS.md "Props"), checked without WebGL. */
interface GltfNode { name?: string; mesh?: number }
interface Gltf {
  nodes: GltfNode[];
  meshes: { primitives: { indices?: number }[] }[];
  accessors: { count: number }[];
  materials: unknown[];
  scenes: { nodes: number[] }[];
}
interface DebrisMeta {
  version: number;
  bytes: number;
  pieces: { name: string; kind: string; size: number[]; tris: number }[];
}

const url = (rel: string): URL => new URL(`../public/models/props/${rel}`, import.meta.url);
const NAMES = ['Plank_L', 'Plank_M', 'Plank_S', 'Splinter_A', 'Splinter_B', 'Barrel_Stave', 'Cloth_A', 'Cloth_B', 'Rope_Coil'];

function readGlb(): { gltf: Gltf; bytes: number } {
  const data = readFileSync(url('debris.glb'));
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  const jsonLen = view.getUint32(12, true);
  return { gltf: JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + jsonLen))) as Gltf, bytes: data.byteLength };
}

describe('debris props', () => {
  it('ships the GLB and its meta', () => {
    expect(readFileSync(url('debris.glb')).byteLength).toBeGreaterThan(0);
    expect(readFileSync(url('debris.meta.json')).byteLength).toBeGreaterThan(0);
  });

  const { gltf, bytes } = readGlb();
  const meta = JSON.parse(new TextDecoder().decode(readFileSync(url('debris.meta.json')))) as DebrisMeta;
  const top = gltf.scenes[0]?.nodes.map((i) => gltf.nodes[i]) ?? [];

  it('has the nine pieces as top-level meshes with clean names', () => {
    expect(top.map((n) => n?.name).sort()).toEqual([...NAMES].sort());
    for (const n of top) {
      expect(n?.name).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(n?.mesh).toBeDefined();
    }
  });

  it('shares one material and stays under 400 KB', () => {
    expect(gltf.materials).toHaveLength(1);
    expect(bytes).toBeLessThan(400_000);
    expect(meta.bytes).toBe(bytes);
  });

  it('keeps every piece within 40-300 triangles', () => {
    for (const n of top) {
      const tris = (gltf.meshes[n?.mesh ?? -1]?.primitives ?? []).reduce((s, p) => s + (gltf.accessors[p.indices ?? -1]?.count ?? 0) / 3, 0);
      expect(tris, n?.name).toBeGreaterThanOrEqual(40);
      expect(tris, n?.name).toBeLessThanOrEqual(300);
      expect(meta.pieces.find((p) => p.name === n?.name)?.tris, n?.name).toBe(tris);
    }
  });

  it('lists every piece in the meta with a kind and a plausible size', () => {
    expect(meta.pieces.map((p) => p.name).sort()).toEqual([...NAMES].sort());
    for (const p of meta.pieces) {
      expect(['wood', 'cloth', 'rope'], p.name).toContain(p.kind);
      expect(p.size).toHaveLength(3);
      for (const e of p.size) {
        expect(e, p.name).toBeGreaterThan(0.01);
        expect(e, p.name).toBeLessThan(1.5);
      }
    }
    const len = (n: string): number => meta.pieces.find((p) => p.name === n)?.size[0] ?? 0;
    expect(len('Plank_L')).toBeGreaterThan(len('Plank_M'));
    expect(len('Plank_M')).toBeGreaterThan(len('Plank_S'));
  });
});
