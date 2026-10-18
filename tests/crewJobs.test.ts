import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCrew } from '../src/gameplay/crew';
import { CREW, JOBS } from '../src/gameplay/crewData';
import { crewLayout } from '../src/gameplay/crewLayout';
import { createShipCrews } from '../src/gameplay/shipCrews';
import { SHIP_SPECS, createDeck, getShipSpec, type ShipModelMeta } from '../src/ships';

const read = (rel: string): string => new TextDecoder().decode(readFileSync(new URL(`../public/models/${rel}`, import.meta.url)));
const DT = 1 / 60;
const brig = getShipSpec('brig')!;
const deck = createDeck(JSON.parse(read('ships/brig.meta.json')) as ShipModelMeta);
const layout = crewLayout(brig, deck);

const anims = (crew: ReturnType<typeof createCrew>): string[] => crew.view().map((s) => s.anim);
const run = (crew: ReturnType<typeof createCrew>, seconds: number): void => {
  for (let i = 0; i < seconds / DT; i++) crew.update(DT);
};

describe('crew layout', () => {
  it('finds the masts, the helm and gun stations on free deck for every ship with a deck', () => {
    for (const spec of SHIP_SPECS) {
      let meta: ShipModelMeta;
      try {
        meta = JSON.parse(read(`ships/${spec.id}.meta.json`)) as ShipModelMeta;
      } catch {
        continue;
      }
      const d = createDeck(meta);
      const l = crewLayout(spec, d);
      expect(l.masts).toHaveLength(spec.masts.length);
      expect(l.helm, `${spec.id} helm`).not.toBeNull();
      if (l.helm) expect(d.walkable(l.helm.x, l.helm.z, CREW.bodyRadius)).toBe(true);
      for (const side of [l.guns.port, l.guns.starboard]) for (const g of side) expect(d.walkable(g.x, g.z, CREW.bodyRadius), `${spec.id} gun spot`).toBe(true);
      if (spec.stats.cannons > 0) expect(l.guns.port.length + l.guns.starboard.length, `${spec.id} guns`).toBeGreaterThan(0);
    }
  });
});

describe('crew jobs', () => {
  it('puts one sailor at the helm from the start, the wheel following the rudder', () => {
    const crew = createCrew(deck, 10, 4, layout);
    crew.helm(0.8);
    run(crew, 1);
    const helmsman = crew.view().filter((s) => s.anim === 'Helm');
    expect(helmsman).toHaveLength(1);
    expect(helmsman[0]?.lean).toBeCloseTo(0.8, 5);
  });

  it('sends hands up the masts and onto the halyards when the sails change, then lets them go', () => {
    const crew = createCrew(deck, 10, 4, layout);
    crew.sails(0.5);
    run(crew, 1);
    crew.sails(1);
    let sawClimb = false;
    let sawAloft = false;
    let maxLift = 0;
    for (let i = 0; i < 25 / DT; i++) {
      crew.update(DT);
      const v = crew.view();
      if (v.some((s) => s.anim === 'Climb')) sawClimb = true;
      if (v.some((s) => s.anim === 'Aloft')) sawAloft = true;
      for (const s of v) maxLift = Math.max(maxLift, s.y - deck.heightAt(s.x));
    }
    expect(sawClimb).toBe(true);
    expect(sawAloft).toBe(true);
    expect(maxLift).toBeGreaterThan(3);
    expect(anims(crew)).not.toContain('Climb');
    expect(anims(crew)).not.toContain('Haul');
    for (const s of crew.view()) if (s.anim !== 'Helm') expect(s.y).toBeCloseTo(deck.heightAt(s.x), 5);
  });

  it('sends gun crews to fire and then load after a broadside', () => {
    const crew = createCrew(deck, 10, 4, layout);
    crew.fire('starboard', 6);
    const seen = new Set<string>();
    for (let i = 0; i < 12 / DT; i++) {
      crew.update(DT);
      for (const a of anims(crew)) seen.add(a);
    }
    expect(seen.has('Fire')).toBe(true);
    expect(seen.has('Load')).toBe(true);
    expect(anims(crew)).not.toContain('Load'); // done again after the reload
  });

  it('stays on free deck with all the jobs going, and is deterministic', () => {
    const play = (): ReturnType<ReturnType<typeof createCrew>['view']> => {
      const crew = createCrew(deck, 10, 9, layout);
      for (let i = 0; i < 120 / DT; i++) {
        if (i % 600 === 0) crew.sails((i / 600) % 2);
        if (i % 420 === 0) crew.fire(i % 840 === 0 ? 'port' : 'starboard', 6);
        crew.update(DT);
        if (i % 30 === 0) for (const s of crew.view()) expect(deck.walkable(s.x, s.z, CREW.bodyRadius - 1e-6), `sailor ${s.id}`).toBe(true);
      }
      return crew.view();
    };
    expect(play()).toEqual(play());
  });

  it('does nothing special without a layout', () => {
    const crew = createCrew(deck, 6, 2);
    crew.sails(0);
    crew.sails(1);
    crew.fire('port', 6);
    run(crew, 20);
    for (const a of anims(crew)) expect(['Idle', 'Walk', 'Run']).toContain(a);
  });

  it('keeps a climber below the cap and a job within the declared times', () => {
    expect(JOBS.climbMax).toBeLessThanOrEqual(12);
    expect(JOBS.climbTime).toBeGreaterThan(1);
  });
});

describe('crews of other ships', () => {
  it('exist only near the player and only for ships with a loaded deck', () => {
    const crews = createShipCrews();
    // no GLB assets are loaded in the test environment, so no ship has a deck
    expect(crews.view('e:1', { specId: 'brig', rudder: 0, sailTarget: 1 }, 100)).toBeUndefined();
    expect(crews.view('e:1', { specId: 'brig', rudder: 0, sailTarget: 1 }, 5000)).toBeUndefined();
  });
});
