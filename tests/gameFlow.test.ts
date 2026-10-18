import { describe, expect, it } from 'vitest';
import { CONFIG, type GameEvent } from '../src/core';
import { createGame, type Game } from '../src/gameplay';
import { getShipSpec } from '../src/ships';

const brig = getShipSpec('brig')!;
const DT = 1 / 60;
const FAR = { x: 40000, z: 40000 }; // open sea far from every island (and from the enemy)

/** Run `seconds` of game time with sails furled, collecting every event on the way. */
function run(game: Game, seconds: number, events: GameEvent[] = []): GameEvent[] {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    game.update(DT, { rudder: 0, sailStep: 0 });
    // View once per ~frame, as the app does, so events are drained and not lost.
    if (i % 3 === 0) events.push(...game.view().events);
  }
  events.push(...game.view().events);
  return events;
}

describe('an enemy that is badly hurt', () => {
  it('breaks off, is lost, and is replaced 25 s later, without counting as a kill', () => {
    const game = createGame(brig);
    const first = game.view().enemies[0]!;
    expect(first.fleeing).toBe(false);

    game.dev.damageEnemies(0.1);
    game.update(DT, { rudder: 0, sailStep: 0 });
    expect(game.view().enemies[0]!.fleeing).toBe(true);

    // The player slips away: the enemy loses him after 30 s beyond 1.5 km.
    game.dev.teleportPlayer(FAR.x, FAR.z);
    const events = run(game, CONFIG.giveUpSeconds + 1);
    expect(events.filter((e) => e.type === 'escaped')).toHaveLength(1);
    expect(game.view().enemies.filter((e) => e.sinking < 0)).toHaveLength(0);
    expect(game.view().kills).toBe(0);

    // Nothing arrives for most of the 25 s (1 s of which has passed), then a fresh enemy ~650 m from the player.
    run(game, 20);
    expect(game.view().enemies).toHaveLength(0);
    run(game, 8);
    const next = game.view().enemies;
    expect(next).toHaveLength(1);
    expect(next[0]!.id).not.toBe(first.id);
    expect(next[0]!.distance).toBeGreaterThan(550);
    expect(next[0]!.distance).toBeLessThan(750);
  });

  it('does not fire while it is running', () => {
    const game = createGame(brig);
    game.dev.damageEnemies(0.1);
    // Let it come into the range where it would otherwise fight: ~650 m at a few m/s is a long way,
    // so put the player 120 m from it by teleporting next to it.
    const e = game.view().enemies[0]!;
    game.dev.teleportPlayer(e.x, e.z - 120);
    const events = run(game, 40);
    expect(events.some((x) => x.type === 'fire' && x.owner === 'enemy')).toBe(false);
  });
});

describe('several enemies', () => {
  const afloat = (game: Game) => game.view().enemies.filter((e) => e.sinking < 0);

  it('adds a second after 2 kills and a third after 4, staggered, each a different type and nation', () => {
    const game = createGame(brig);
    run(game, 1);
    expect(afloat(game)).toHaveLength(1);

    game.dev.setKills(2);
    run(game, 1);
    expect(afloat(game)).toHaveLength(2);

    // The third needs 4 kills, and then the stagger (12 s) since the second arrived.
    game.dev.setKills(4);
    run(game, 5);
    expect(afloat(game)).toHaveLength(2);
    run(game, 9);
    expect(afloat(game)).toHaveLength(3);
    run(game, 20); // and never more than three
    expect(afloat(game).length).toBeLessThanOrEqual(3);

    const squad = afloat(game);
    expect(new Set(squad.map((e) => e.id)).size).toBe(3);
    expect(new Set(squad.map((e) => e.specId)).size).toBe(3); // a mixed squadron
    expect(squad.map((e) => e.nation)).toEqual(['pirate', 'spanish', 'french']); // in turn, in arrival order
  });

  it('keeps enemies apart when they arrive', () => {
    const game = createGame(brig);
    game.dev.setKills(4);
    run(game, 30);
    const squad = afloat(game);
    expect(squad).toHaveLength(3);
    for (const a of squad) {
      for (const b of squad) {
        if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(70);
      }
    }
  });
});
