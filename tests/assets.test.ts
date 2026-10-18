import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHIP_SPECS, getShipSpec } from '../src/ships';

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
  materials: { name?: string; emissiveFactor?: number[]; normalTexture?: unknown; occlusionTexture?: unknown; pbrMetallicRoughness?: { metallicRoughnessTexture?: unknown } }[];
  extensionsUsed?: string[];
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

interface ShipMeta {
  id: string;
  length: number;
  lods: Record<string, { tris: number; meshes: number; drawCalls: number }>;
  trimPivot: number[];
  deck: { columns: string[]; stations: number[][] };
  obstacles: { type: string; x?: number; z?: number; r?: number; x0?: number; x1?: number; z0?: number; z1?: number }[];
}

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

/** Per-ship ceilings written by tools/blender/make_ships.py (`budgets()`) and pbrship.py (`budgets()`); keep both in step. */
const contractBudgets = (length: number, pbr: boolean): Record<string, number> =>
  pbr
    ? { LOD0: Math.floor(8000 + 700 * length), LOD1: Math.floor(600 + 95 * length), LOD2: Math.floor(300 + 35 * length) }
    : { LOD0: Math.floor(1700 + 140 * length), LOD1: Math.floor(160 + 20 * length), LOD2: Math.floor(60 + 6 * length) };

interface GeneratedMeta extends ShipMeta {
  pbr?: boolean;
  atlasPx?: number;
  specHash: string;
  beam: number;
  budgets: Record<string, number>;
  bytes: number;
  deckMargin: number;
}

/** Same canonical form as tools/blender/make_ships.py `spec_hash`: sorted keys, no spaces, FNV-1a 32. */
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
      : JSON.stringify(v);
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

describe.each(SHIP_SPECS.map((s) => s.id))('%s (generic ship builder)', (id) => {
  const spec = getShipSpec(id);
  if (!spec) throw new Error(`no spec for ${id}`);
  const { gltf: g, bytes } = readGlb(`ships/${id}.glb`);
  const meta = readJson<GeneratedMeta>(`ships/${id}.meta.json`);
  const lods = [0, 1, 2].map((l) => stats(g, find(g, `LOD${l}`)));
  const pbr = meta.pbr === true; // the flagship ships carry baked PBR textures, the rest a flat-colour atlas
  const pivots = (l: number): number[] => g.nodes.flatMap((n, i) => ((n.name ?? '').startsWith(`LOD${l}_`) && (n.name ?? '').includes('_trim-') ? [i] : []));

  it('has the root, three LOD groups and clean names', () => {
    expect(find(g, id)).toBeGreaterThanOrEqual(0);
    for (const n of g.nodes) expect(n.name ?? '', n.name).toMatch(NAME_OK);
    lods.forEach((s, l) => expect(s.meshes, `LOD${l}`).toBeGreaterThan(0));
  });

  it('stays inside the length-scaled triangle budgets and shrinks with each LOD', () => {
    const b = contractBudgets(spec.length, pbr);
    expect(meta.budgets).toEqual(b);
    lods.forEach((s, l) => expect(s.tris, `LOD${l}`).toBeLessThanOrEqual(b[`LOD${l}`] ?? 0));
    expect(lods[1]?.tris).toBeLessThan((lods[0]?.tris ?? 0) * 0.3);
    expect(lods[2]?.tris).toBeLessThan((lods[1]?.tris ?? 0) * 0.6);
  });

  it('keeps the material and texture counts of its kind', () => {
    if (pbr) {
      // atlas, wood, sail (3 textures each: albedo, normal, packed occlusion-roughness-metalness) + emissive glass + flag
      expect(g.materials.length).toBeLessThanOrEqual(5);
      expect(g.images?.length).toBe(9);
      expect(meta.atlasPx).toBeLessThanOrEqual(2048);
    } else {
      expect(g.materials.length).toBeLessThanOrEqual(3); // atlas + emissive glass + the flag cloth the game tints
      expect(g.images?.length).toBe(1);
    }
  });

  it.runIf(pbr)('stores baked PBR textures: albedo + normal + one ORM image per material, WebP, meshopt geometry', () => {
    expect(g.extensionsUsed).toEqual(expect.arrayContaining(['EXT_texture_webp', 'EXT_meshopt_compression']));
    for (const suffix of ['atlas', 'wood', 'sail']) {
      const m = g.materials.find((x) => x.name === `${id}_${suffix}`);
      expect(m, suffix).toBeDefined();
      expect(m?.normalTexture, `${suffix} normal`).toBeDefined();
      expect(m?.occlusionTexture, `${suffix} occlusion`).toBeDefined();
      expect(m?.pbrMetallicRoughness?.metallicRoughnessTexture, `${suffix} metal-rough`).toBeDefined();
    }
    const glass = g.materials.find((x) => x.name === `${id}_glass`);
    expect(glass?.emissiveFactor?.some((c) => c > 0)).toBe(true); // the night-time glow the game drives
    expect(g.nodes.some((n) => n.name === 'LOD0_Glass')).toBe(true);
    expect(g.nodes.some((n) => n.name === 'LOD0_Flag')).toBe(true); // tinted per nation by glbShip
  });

  it('has one sail pivot per sail group on every LOD, each carrying a sail mesh', () => {
    const counts = [0, 1, 2].map((l) => pivots(l).length);
    expect(counts[0]).toBeGreaterThanOrEqual(spec.masts.length);
    expect(counts[1]).toBe(counts[0]);
    expect(counts[2]).toBe(counts[0]);
    for (const l of [0, 1, 2]) for (const p of pivots(l)) expect(stats(g, p).meshes).toBeGreaterThanOrEqual(1);
  });

  it('matches the spec dimensions', () => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const n of g.nodes) {
      if (n.mesh === undefined || (n.name ?? '') !== 'LOD0_Body') continue;
      for (const p of g.meshes[n.mesh]?.primitives ?? []) {
        const a = g.accessors[p.attributes.POSITION ?? -1];
        a?.min?.forEach((v, k) => (lo[k] = Math.min(lo[k] ?? v, v)));
        a?.max?.forEach((v, k) => (hi[k] = Math.max(hi[k] ?? v, v)));
      }
    }
    const length = (hi[0] ?? 0) - (lo[0] ?? 0);
    const beam = (hi[2] ?? 0) - (lo[2] ?? 0);
    expect(length).toBeGreaterThanOrEqual(spec.length);
    expect(length).toBeLessThanOrEqual(spec.length * 1.15 + spec.bowsprit + 1);
    expect(beam).toBeGreaterThanOrEqual(spec.beam * 0.9);
    // cannon muzzles (0.45 m each side) and the hung anchors stand out of the hull; oars much more
    expect(beam).toBeLessThanOrEqual(spec.beam * 1.15 + (pbr ? 3.5 : 1.2) + (spec.oars > 0 ? spec.length * 0.4 : 0));
    expect(lo[1] ?? 0).toBeLessThan(0);
  });

  it('has consistent metadata: triangle counts, ordered deck, one obstacle per mast', () => {
    for (const l of [0, 1, 2]) expect(meta.lods[`LOD${l}`]?.tris).toBe(lods[l]?.tris);
    const xs = meta.deck.stations.map((s) => s[0] ?? 0);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    for (const s of meta.deck.stations) {
      expect(s[1]).toBeGreaterThan(0.3);
      expect(s[2]).toBeGreaterThanOrEqual(0);
    }
    // one per mast plus up to three cargo barrels (full-quality extras), and the capstan of the PBR ships
    const circles = meta.obstacles.filter((o) => o.type === 'circle').length;
    expect(circles).toBeGreaterThanOrEqual(spec.masts.length);
    expect(circles).toBeLessThanOrEqual(spec.masts.length + 3 + (pbr ? 1 : 0));
    // one rect per castle plus the hatch coaming added to the full-quality model (needs a mast to place it)
    const hatch = spec.masts.length > 0 ? 1 : 0;
    expect(meta.obstacles.filter((o) => o.type === 'rect')).toHaveLength((spec.forecastle ? 1 : 0) + (spec.sterncastle ? 1 : 0) + hatch);
  });

  it('was built from the current spec (re-run make_ships.py after changing specs.ts)', () => {
    expect(meta.specHash).toBe(fnv1a(canonical(JSON.parse(JSON.stringify(spec)))));
  });

  it('puts every sail pivot on its mast base, identically on all LODs', () => {
    spec.masts.forEach((m, i) => {
      const found = [0, 1, 2].flatMap((l) =>
        g.nodes.filter((n) => (n.name ?? '').startsWith(`LOD${l}_m${i}_trim-`)).map((n) => n.translation ?? [NaN, NaN, NaN]),
      );
      expect(found.length, `mast ${i}`).toBeGreaterThanOrEqual(3);
      for (const t of found) {
        expect(t[0]).toBeCloseTo((0.5 - m.at) * spec.length, 2);
        expect(t[1]).toBeGreaterThan(0.3);
        expect(t[2]).toBeCloseTo(0, 5);
        expect(t[1]).toBeCloseTo(found[0]?.[1] ?? NaN, 5);
      }
    });
  });

  it('stays small enough to load quickly', () => {
    expect(bytes).toBeLessThan(pbr ? 2_200_000 : 500_000);
  });
});
