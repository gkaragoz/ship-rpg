import { describe, expect, it } from 'vitest';
import { cloneState, createGame, newGameState } from '../src/gameplay';
import { getShipSpec } from '../src/ships';

const brig = getShipSpec('brig')!;
const DT = 1 / 60;
const idle = { rudder: 0, sailStep: 0 as const };

describe('game state', () => {
  it('starts full, rich enough to shop, and survives JSON', () => {
    const s = newGameState(brig);
    expect(s.ship).toMatchObject({ specId: 'brig', hp: brig.stats.hp, rigging: 1 });
    expect(s.crew).toBe(brig.stats.crew);
    expect(s.captain.gold).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('clones without sharing', () => {
    const s = newGameState(brig);
    const c = cloneState(s);
    c.hold.rum = 3;
    c.discovered.ports.push('x');
    expect(s.hold).toEqual({});
    expect(s.discovered.ports).toEqual([]);
  });

  it('accepts a ship spec or a state, and the snapshot reflects play', () => {
    const game = createGame(brig);
    expect(game.spec.id).toBe('brig');
    for (let i = 0; i < 120; i++) game.update(DT, idle);
    const snap = game.state();
    expect(snap.time).toBeCloseTo(2, 1);
    expect(snap.discovered.islands.length).toBeGreaterThan(0);
    expect(snap.pose.dockedAt).toBeNull();
  });

  it('resumes from a state: pose, hull, afflictions, discoveries, time, docking', () => {
    const first = createGame(brig);
    first.dev.teleportPlayer(first.state().pose.x + 300, first.state().pose.z);
    first.dev.setRigging(0.5);
    const s = first.state();
    s.ship.hp = 1234;
    s.captain.gold = 77;
    s.time = 100;
    const again = createGame(s);
    const back = again.state();
    expect(back.pose.x).toBeCloseTo(s.pose.x, 3);
    expect(back.ship).toMatchObject({ hp: 1234, rigging: 0.5 });
    expect(back.captain.gold).toBe(77);
    expect(back.time).toBe(100);
    expect(back.discovered).toEqual(s.discovered);
    expect(again.view().captain.gold).toBe(77);
  });

  it('exposes ship identity and the current reload time in the view', () => {
    const v = createGame(brig).view();
    expect(v.ship).toMatchObject({ specId: 'brig', name: brig.name, reloadSeconds: 6 });
    expect(v.company).toMatchObject({ count: brig.stats.crew, max: brig.stats.crew, factor: 1 });
    expect(v.cargo).toMatchObject({ used: 0, capacity: brig.stats.hold });
  });
});
