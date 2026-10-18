import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getShipSpec } from '../src/ships';

/**
 * Contract for the Blender-made GLB assets in public/models (docs/SHIP_ASSETS.md).
 * These tests are the gate for anything the local LLM generates: naming, triangle budgets,
 * material counts, pivots and bounds are checked here, without WebGL.
 */
interface GltfNode { name?: string; children?: number[]; mesh?: number; skin?: number; translation?: number[] }
interface Gltf {
  nodes: GltfNode[];
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors: { count: number; min?: number[]; max?: number[] }[];
  materials: { name?: string; emissiveFactor?: number[] }[];
  images?: unknown[];
  skins?: { joints: number[] }[];
  animations?: { name?: string }[];
  scenes: { nodes: number[] }[];
}

const url = (rel: string): URL => new URL(`../public/models/${rel}`, import.meta.url);

function readGlb(rel: string): { gltf: Gltf; bytes: number } {
  const data = readFileSync(url(rel));
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  const jsonLen = view.getUint32(12, true);
  const text = new TextDecoder().decode(data.subarray(20, 20 + jsonLen));
  return { gltf: JSON.parse(text) as Gltf, bytes: data.byteLength };
}

const readJson = <T>(rel: string): T => JSON.parse(new TextDecoder().decode(readFileSync(url(rel)))) as T;

function find(g: Gltf, name: string): number {
  return g.nodes.findIndex((n) => n.name === name);
}

/** Triangles and mesh nodes under a node (depth-first). */
function stats(g: Gltf, root: number): { tris: number; meshes: number; materials: Set<number> } {
  const out = { tris: 0, meshes: 0, materials: new Set<number>() };
  const walk = (i: number): void => {
    const n = g.nodes[i];
    if (!n) return;
    if (n.mesh !== undefined) {
      out.meshes++;
      for (const p of g.meshes[n.mesh]?.primitives ?? []) {
        const idx = p.indices;
        out.tris += idx !== undefined ? (g.accessors[idx]?.count ?? 0) / 3 : 0;
      }
    }
    n.children?.forEach(walk);
  };
  walk(root);
  return out;
}

const NAME_OK = /^[A-Za-z0-9_.-]+$/;

describe('tartane.glb (ship contract)', () => {
  const { gltf: g, bytes } = readGlb('ships/tartane.glb');
  const spec = getShipSpec('tartane');
  if (!spec) throw new Error('tartane spec missing');
  const budgets = [2000, 450, 130];

  it('has a root and three LOD groups with no-dot, no-space names', () => {
    expect(find(g, 'tartane')).toBeGreaterThanOrEqual(0);
    for (const n of g.nodes) expect(n.name ?? '', n.name).toMatch(NAME_OK);
    for (const l of [0, 1, 2]) {
      const i = find(g, `LOD${l}`);
      expect(i, `LOD${l}`).toBeGreaterThanOrEqual(0);
      expect(g.nodes[i]?.children?.length).toBeGreaterThan(0);
    }
  });

  it('keeps every LOD inside its triangle and draw-call budget, strictly decreasing', () => {
    const tris = [0, 1, 2].map((l) => stats(g, find(g, `LOD${l}`)));
    tris.forEach((s, l) => {
      expect(s.tris, `LOD${l} tris`).toBeLessThanOrEqual(budgets[l] ?? 0);
      expect(s.tris).toBeGreaterThan(0);
      expect(s.meshes, `LOD${l} meshes`).toBeLessThanOrEqual(l === 0 ? 4 : 2);
    });
    expect(tris[0]?.tris).toBeGreaterThan(tris[1]?.tris ?? 0);
    expect(tris[1]?.tris).toBeGreaterThan(tris[2]?.tris ?? 0);
  });

  it('uses at most two materials (shared atlas + emissive lantern) and one image', () => {
    expect(g.materials.length).toBeLessThanOrEqual(2);
    expect(g.images?.length).toBe(1);
    expect(g.materials.filter((m) => m.emissiveFactor)).toHaveLength(1);
  });

  it('has a sail pivot per LOD that carries the sail mesh', () => {
    for (const l of [0, 1, 2]) {
      const p = find(g, `LOD${l}_trim-aft`);
      expect(p, `LOD${l}_trim-aft`).toBeGreaterThanOrEqual(0);
      expect(stats(g, p).meshes).toBeGreaterThanOrEqual(1);
      expect(g.nodes[p]?.translation?.[0]).toBeCloseTo(0.96, 2); // on the mast axis
    }
  });

  it('matches the spec dimensions (length incl. bowsprit/rudder, beam)', () => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const root = stats(g, find(g, 'LOD0'));
    expect(root.meshes).toBeGreaterThan(0);
    for (const n of g.nodes) {
      if (n.mesh === undefined || !(n.name ?? '').startsWith('LOD0_Body')) continue;
      for (const p of g.meshes[n.mesh]?.primitives ?? []) {
        const a = g.accessors[p.attributes.POSITION ?? -1];
        a?.min?.forEach((v, k) => (lo[k] = Math.min(lo[k] ?? v, v)));
        a?.max?.forEach((v, k) => (hi[k] = Math.max(hi[k] ?? v, v)));
      }
    }
    const length = (hi[0] ?? 0) - (lo[0] ?? 0);
    const beam = (hi[2] ?? 0) - (lo[2] ?? 0);
    expect(length).toBeGreaterThanOrEqual(spec.length);
    expect(length).toBeLessThanOrEqual(spec.length * 1.3);
    expect(beam).toBeCloseTo(spec.beam, 0);
    expect(lo[1] ?? 0).toBeLessThan(0); // keel below the waterline
  });

  it('stays small', () => {
    expect(bytes).toBeLessThan(300_000);
  });
});

interface ShipMeta {
  id: string;
  length: number;
  lods: Record<string, { tris: number; meshes: number; drawCalls: number }>;
  trimPivot: number[];
  deck: { columns: string[]; stations: number[][] };
  obstacles: { type: string; x?: number; z?: number; r?: number; x0?: number; x1?: number; z0?: number; z1?: number }[];
}

describe('tartane.meta.json', () => {
  const meta = readJson<ShipMeta>('ships/tartane.meta.json');
  const { gltf: g } = readGlb('ships/tartane.glb');

  it('reports the same triangle counts as the GLB', () => {
    for (const l of [0, 1, 2]) {
      expect(meta.lods[`LOD${l}`]?.tris).toBe(stats(g, find(g, `LOD${l}`)).tris);
    }
  });

  it('has an ordered deck profile and sane obstacles', () => {
    expect(meta.deck.columns).toEqual(['x', 'y', 'halfWidth']);
    const xs = meta.deck.stations.map((s) => s[0] ?? 0);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    for (const s of meta.deck.stations) {
      expect(s[1]).toBeGreaterThan(0.5);
      expect(s[2]).toBeGreaterThanOrEqual(0); // 0 at the bow tip: too narrow to stand
    }
    expect(Math.max(...meta.deck.stations.map((s) => s[2] ?? 0))).toBeGreaterThan(1.5);
    expect(meta.obstacles.length).toBeGreaterThan(3);
    expect(meta.trimPivot[0]).toBeCloseTo(0.96, 2);
  });
});

describe('crew GLBs', () => {
  const variants = ['Male_Standard', 'Male_Broad', 'Male_Stout', 'Female_Standard', 'Female_Sturdy', 'Female_Stout'];
  const bones = ['Root', 'Hips', 'Spine', 'Head', 'UpperArm.L', 'LowerArm.L', 'UpperArm.R', 'LowerArm.R',
    'UpperLeg.L', 'LowerLeg.L', 'UpperLeg.R', 'LowerLeg.R'];

  for (const v of variants) {
    it(`${v}: 12-bone skin, Idle/Walk/Run, 7 shared materials, 3 LODs within budget`, () => {
      const { gltf: g, bytes } = readGlb(`crew/${v}.glb`);
      expect(g.skins?.[0]?.joints).toHaveLength(12);
      for (const b of bones) expect(find(g, b), b).toBeGreaterThanOrEqual(0);
      expect((g.animations ?? []).map((a) => a.name).sort()).toEqual(['Idle', 'Run', 'Walk']);
      expect(g.materials.map((m) => m.name).sort()).toEqual(['Belt', 'Boots', 'Hair', 'Hat', 'Pants', 'Shirt', 'Skin']);
      const lod = [0, 1, 2].map((l) => stats(g, find(g, `LOD${l}`)));
      // LOD0 also holds every optional hair/hat variant, so its budget is the whole kit.
      expect(lod[0]?.tris).toBeLessThanOrEqual(900);
      expect(lod[1]?.tris).toBeLessThanOrEqual(200);
      expect(lod[2]?.tris).toBeLessThanOrEqual(100);
      expect(bytes).toBeLessThan(250_000);
    });
  }

  it('ships a palette for tinting', () => {
    const meta = readJson<{ palette: Record<string, string[]>; animations: Record<string, number[]> }>('crew/crew.json');
    for (const k of ['skin', 'shirt', 'pants', 'hair', 'hat']) expect(meta.palette[k]?.length).toBeGreaterThan(2);
    expect(Object.keys(meta.animations).sort()).toEqual(['Idle', 'Run', 'Walk']);
  });
});
