import { describe, expect, it } from 'vitest';
import { createGame } from '../src/gameplay';
import { MAX_SAVED_BALLS, sanitizeSea } from '../src/gameplay/seaState';
import { MIGRATIONS, parseSave, sanitizeState, serializeSave } from '../src/gameplay/save';
import { newGameState } from '../src/gameplay/state';
import { getShipSpec } from '../src/ships';

const brig = getShipSpec('brig')!;
const DT = 1 / 60;

describe('the sea in a save', () => {
  it('keeps the enemies and the balls of a fight at sea, and goes on from there', () => {
    const game = createGame(newGameState(brig));
    const foe = game.view().enemies[0]!;
    game.dev.teleportPlayer(foe.x + 80, foe.z + 40);
    game.dev.damageEnemies(0.6);
    for (let i = 0; i < 60 * 40; i++) game.update(DT, { rudder: 0, sailStep: 0, firePort: i % 400 === 5, fireStarboard: i % 400 === 205 });
    const saved = game.state();
    expect(saved.sea).toBeDefined();
    expect(saved.sea!.enemies.length).toBeGreaterThan(0);
    const back = parseSave(serializeSave(saved, '2026-01-01T00:00:00Z'));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.state.sea).toEqual(saved.sea);

    const resumed = createGame(back.state);
    const before = game.view();
    const after = resumed.view();
    expect(after.enemies.map((e) => [e.specId, e.nation, Math.round(e.x), Math.round(e.z), e.hp])).toEqual(before.enemies.filter((e) => e.sinking < 0).map((e) => [e.specId, e.nation, Math.round(e.x), Math.round(e.z), e.hp]));
    expect(after.kills).toBe(before.kills);
    for (let i = 0; i < 60 * 5; i++) resumed.update(DT, { rudder: 0, sailStep: 0 });
    expect(resumed.view().sunk).toBe(false);
  });

  it('is not saved when the ship is moored, and a moored save meets a fresh enemy', () => {
    const game = createGame(newGameState(brig));
    game.update(DT, { rudder: 0, sailStep: 0, interact: true });
    expect(game.view().docked).not.toBeNull();
    expect(game.state().sea).toBeUndefined();
  });

  it('is cleaned: unknown ships and nations dropped, numbers clamped, counts capped', () => {
    expect(sanitizeSea('x')).toBeUndefined();
    const raw = {
      enemies: [{ specId: 'nonexistent' }, { specId: 'brig', nation: 'martian' }, ...Array(6).fill({ specId: 'brig', nation: 'pirate', hp: 1e9, x: 1e9, rigging: 9, fleeing: 'yes' })],
      balls: [...Array(100).fill({ owner: 'enemy', x: 5, y: 3, z: 5, vx: 9999, age: 99, damage: -4 }), { owner: 'nobody' }, 3],
      counter: -5,
      threat: 1.7,
    };
    const sea = sanitizeSea(raw)!;
    expect(sea.enemies).toHaveLength(3);
    expect(sea.enemies[0]).toMatchObject({ specId: 'brig', nation: 'pirate', fleeing: false, rigging: 1 });
    expect(sea.enemies[0]!.hp).toBeLessThanOrEqual(brig.stats.hp);
    expect(sea.enemies[0]!.x).toBeLessThan(1e5);
    expect(sea.balls).toHaveLength(MAX_SAVED_BALLS);
    expect(sea.balls[0]).toMatchObject({ vx: 400, age: 6, damage: 0 });
    expect(sea.counter).toBe(0);
    expect(sea.threat).toBe(1);
    expect(sanitizeState({ ...newGameState(brig), sea: 'nonsense' })?.sea).toBeUndefined();
  });

  it('migrates from version 4 untouched, with no sea', () => {
    const old = { ...newGameState(brig) } as Record<string, unknown>;
    delete old.sea;
    const r = parseSave(JSON.stringify({ version: 4, savedAt: '2026-01-01T00:00:00Z', state: old }));
    expect(MIGRATIONS[4]).toBeDefined();
    expect(r.ok && r.state.sea).toBeUndefined();
  });
});
