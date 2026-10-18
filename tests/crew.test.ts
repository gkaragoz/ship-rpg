import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCrew, crewCountFor } from '../src/gameplay/crew';
import { CREW, CREW_PALETTE_SIZES, CREW_VARIANTS } from '../src/gameplay/crewData';
import { createNpcFleet, placePatrols } from '../src/gameplay/npcShips';
import { getPort, terrainHeight } from '../src/world';
import { SHIP_SPECS, createDeck, type ShipModelMeta } from '../src/ships';

const read = (rel: string): string =>
  new TextDecoder().decode(readFileSync(new URL(`../public/models/${rel}`, import.meta.url)));
const deck = createDeck(JSON.parse(read('ships/tartane.meta.json')) as ShipModelMeta);
const DT = 1 / 60;

function run(seed: number, seconds: number, count = 6): ReturnType<ReturnType<typeof createCrew>['view']> {
  const crew = createCrew(deck, count, seed);
  for (let i = 0; i < seconds * 60; i++) crew.update(DT);
  return crew.view();
}

describe('crew count', () => {
  it('scales with ship length within limits', () => {
    expect(crewCountFor(12)).toBe(6);
    expect(crewCountFor(2)).toBe(CREW.minCount);
    expect(crewCountFor(200)).toBe(CREW.maxCount);
  });
});

describe('deck crew simulation', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    expect(run(5, 30)).toEqual(run(5, 30));
    expect(run(5, 30)).not.toEqual(run(6, 30));
  });

  it('keeps every sailor on free deck for ten simulated minutes', () => {
    const crew = createCrew(deck, 8, 3);
    for (let i = 0; i < 600 * 60; i++) {
      crew.update(DT);
      if (i % 30 === 0) {
        for (const s of crew.view()) {
          expect(deck.walkable(s.x, s.z, CREW.bodyRadius - 1e-6), `sailor ${s.id} at ${i}`).toBe(true);
        }
      }
    }
  });

  it('actually moves: mixes Idle, Walk and Run, and covers the deck', () => {
    const crew = createCrew(deck, 6, 11);
    const anims = new Set<string>();
    const xs: number[] = [];
    for (let i = 0; i < 300 * 60; i++) {
      crew.update(DT);
      if (i % 20 === 0) crew.view().forEach((s) => { anims.add(s.anim); xs.push(s.x); });
    }
    expect([...anims].sort()).toEqual(['Idle', 'Run', 'Walk']);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(6);
  });

  it('stands on the deck surface and gives valid looks', () => {
    for (const s of run(2, 20, 10)) {
      expect(s.y).toBeCloseTo(deck.heightAt(s.x));
      const l = s.look;
      expect(l.variant).toBeLessThan(CREW_VARIANTS);
      expect(l.skin).toBeLessThan(CREW_PALETTE_SIZES.skin);
      expect(l.shirt).toBeLessThan(CREW_PALETTE_SIZES.shirt);
      expect(l.pants).toBeLessThan(CREW_PALETTE_SIZES.pants);
      expect(l.hair).toBeLessThan(CREW_PALETTE_SIZES.hair);
      expect(l.hat).toBeLessThan(CREW_PALETTE_SIZES.hat);
      if (l.variant >= 3) expect(l.beard).toBe(false);
    }
  });

  it('keeps walking speed at the authored clip speed (never faster)', () => {
    const crew = createCrew(deck, 1, 4);
    let prev = crew.view()[0];
    let best = 0;
    for (let i = 0; i < 120 * 60; i++) {
      crew.update(DT);
      const cur = crew.view()[0];
      if (prev && cur && cur.anim === 'Walk' && prev.anim === 'Walk') {
        best = Math.max(best, Math.hypot(cur.x - prev.x, cur.z - prev.z) / DT);
      }
      prev = cur;
    }
    expect(best).toBeGreaterThan(1.3); // straight stretches reach the full 1.4 m/s
    expect(best).toBeLessThanOrEqual(1.4 + 1e-6);
  });
});

describe('palette sizes match the crew asset', () => {
  it('crew.json', () => {
    const meta = JSON.parse(read('crew/crew.json')) as { palette: Record<string, string[]> };
    for (const k of Object.keys(CREW_PALETTE_SIZES) as (keyof typeof CREW_PALETTE_SIZES)[]) {
      expect(meta.palette[k]?.length, k).toBe(CREW_PALETTE_SIZES[k]);
    }
  });
});

describe('npc fleet', () => {
  it('sails open water around the start (no patrol runs over an island)', () => {
    const port = getPort('douwesen');
    if (!port) throw new Error('no start port');
    const origin = { x: port.anchor.x + Math.cos(port.outward) * 70, z: port.anchor.z + Math.sin(port.outward) * 70 };
    for (const p of placePatrols(origin)) {
      let land = 0;
      for (let i = 0; i < 200; i++) {
        const f = (i / 200) * 2 * Math.PI;
        if (terrainHeight(p.cx + p.a * Math.cos(f), p.cz + p.b * Math.sin(f)) > -4) land++;
      }
      expect(land / 200, p.specId).toBeLessThan(0.03);
    }
  });


  it('is deterministic and keeps each patrol on its ellipse', () => {
    const a = createNpcFleet();
    const b = createNpcFleet();
    for (let i = 0; i < 600; i++) { a.update(DT); b.update(DT); }
    expect(a.view()).toEqual(b.view());
    const placed = placePatrols({ x: 0, z: 0 });
    a.view().slice(0, placed.length).forEach((v, i) => {
      const p = placed[i];
      if (!p) throw new Error('missing patrol');
      expect(((v.x - p.cx) / p.a) ** 2 + ((v.z - p.cz) / p.b) ** 2).toBeCloseTo(1, 6);
      expect(v.specId).toBe(p.specId);
    });
  });

  it('points the bow along the direction of travel', () => {
    const fleet = createNpcFleet();
    const before = fleet.view();
    fleet.update(0.5);
    const after = fleet.view();
    before.slice(0, 12).forEach((v, i) => { // the patrols (the merchants after them lie at the quay now and then)
      const w = after[i];
      if (!w) return;
      const dx = w.x - v.x;
      const dz = w.z - v.z;
      // heading ψ points the bow along (cos ψ, -sin ψ)
      expect(Math.cos(w.heading) * dx - Math.sin(w.heading) * dz).toBeGreaterThan(0);
    });
  });
});

describe('crew on every ship deck', () => {
  it.each(SHIP_SPECS.map((sp) => sp.id))('%s: sailors stay on free deck for two minutes', (id) => {
    const spec = SHIP_SPECS.find((sp) => sp.id === id);
    const d = createDeck(JSON.parse(read(`ships/${id}.meta.json`)) as ShipModelMeta);
    const crew = createCrew(d, crewCountFor(spec?.length ?? 12), 9);
    for (let i = 0; i < 120 * 60; i++) {
      crew.update(DT);
      if (i % 60 === 0) {
        for (const sailor of crew.view()) {
          expect(d.walkable(sailor.x, sailor.z, CREW.bodyRadius - 1e-6), `${id} sailor ${sailor.id}`).toBe(true);
        }
      }
    }
  });
});
