import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ISLANDS, PORTS, NATIONS, terrainHeight } from '../src/world';
import { planNature, planTown } from '../src/render/townPlan';

interface Meta { version: number; bytes: number; props: { name: string; kind: string; size: number[]; tris: [number, number] }[] }
const meta = JSON.parse(new TextDecoder().decode(readFileSync(new URL('../public/models/world/world.meta.json', import.meta.url)))) as Meta;

/** Node names of the GLB's JSON chunk. */
function glbNames(): string[] {
  const buf = new Uint8Array(readFileSync(new URL('../public/models/world/world.glb', import.meta.url)));
  const len = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + len))) as { nodes: { name?: string }[]; materials: unknown[]; images?: unknown[] };
  expect(json.materials).toHaveLength(1); // one shared flat-colour material
  return json.nodes.map((n) => n.name ?? '');
}

describe('world GLB', () => {
  const names = new Set(glbNames());

  it('has both levels of every prop in the meta, one material, a sane size', () => {
    expect(meta.version).toBe(1);
    expect(meta.bytes).toBeLessThan(600_000);
    for (const p of meta.props) {
      expect(names.has(`${p.name}_LOD0`), p.name).toBe(true);
      expect(names.has(`${p.name}_LOD1`), p.name).toBe(true);
      expect(p.tris[0]).toBeLessThanOrEqual(900);
      if (p.tris[0] > 40) expect(p.tris[1], p.name).toBeLessThan(0.65 * p.tris[0]);
      expect(/^[A-Za-z0-9_-]+$/.test(p.name)).toBe(true);
    }
  });

  it('has the props the scenery plans', () => {
    const have = new Set(meta.props.map((p) => p.name));
    const wanted = new Set<string>();
    for (const port of PORTS) for (const p of planTown(port)) wanted.add(p.prop);
    for (const island of ISLANDS) for (const p of planNature(island)) wanted.add(p.prop);
    for (const w of wanted) expect(have.has(w), `${w} missing from the world kit`).toBe(true);
  });
});

describe('town plans', () => {
  it('give every port a town of its nation, with a pier, on land and clear of each other', () => {
    for (const port of PORTS) {
      expect(NATIONS.map((n) => n.id)).toContain(port.nation);
      const a = planTown(port);
      expect(a).toEqual(planTown(port)); // deterministic
      expect(a.filter((p) => p.prop === 'PierPlank').length, port.id).toBeGreaterThanOrEqual(2);
      const houses = a.filter((p) => /^(House|Shack)/.test(p.prop));
      expect(houses.length, `${port.id} houses`).toBeGreaterThanOrEqual(4);
      const style = { english: 'HouseEnglish', french: 'HouseFrench', spanish: 'HouseSpanish', dutch: 'HouseDutch', pirate: 'Shack', free: 'Shack' }[port.nation] as string;
      expect(houses.every((h) => h.prop === style), `${port.id} is built in ${port.nation} style`).toBe(true);
      for (const h of a.filter((p) => !/^(PierPlank|Crane|Rowboat|FishingBoat|Canoe)$/.test(p.prop))) expect(terrainHeight(h.x, h.z), `${port.id} ${h.prop} on land`).toBeGreaterThan(0.5);
      const buildings = a.filter((p) => /^(House|Shack|Tavern|Warehouse|Church|Fort|Windmill)/.test(p.prop));
      for (let i = 0; i < buildings.length; i++) {
        for (let j = i + 1; j < buildings.length; j++) {
          const p = buildings[i]!;
          const q = buildings[j]!;
          expect(Math.hypot(p.x - q.x, p.z - q.z), `${port.id}: ${p.prop} and ${q.prop} overlap`).toBeGreaterThan(5);
        }
      }
    }
  });

  it('keeps the forts and lighthouses where the plan wants them', () => {
    const has = (id: string, prop: string): boolean => planTown(PORTS.find((p) => p.id === id)!).some((p) => p.prop === prop);
    expect(has('douwesen', 'Lighthouse') || has('douwesen', 'Fort')).toBe(true);
    expect(has('khoal-roa', 'Fort')).toBe(false);
  });
});

describe('nature plans', () => {
  it('plant trees on land only, away from the towns', () => {
    for (const island of ISLANDS) {
      const plan = planNature(island);
      expect(plan.length, island.id).toBeGreaterThan(30);
      for (const p of plan) {
        expect(terrainHeight(p.x, p.z)).toBeGreaterThan(0.3);
        for (const t of PORTS.filter((q) => q.islandId === island.id)) expect(Math.hypot(t.town.x - p.x, t.town.z - p.z)).toBeGreaterThan(40);
      }
    }
  });
});
