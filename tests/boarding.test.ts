import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core';
import { createGame } from '../src/gameplay';
import { BOARDING, boardingOdds, enemyCrewOf, lootOf, partyHeads, resolveBoarding } from '../src/gameplay/boarding';
import { createEnemy } from '../src/gameplay/enemy';
import { findPrize } from '../src/gameplay/plunder';
import { createPlayerShip } from '../src/gameplay/sailing';
import { getShipSpec } from '../src/ships';

const spec = (id: string) => getShipSpec(id)!;
const brig = spec('brig');
const DT = 1 / 60;
const idle = { rudder: 0, sailStep: 0 as const };

const crippled = (x: number, hpShare = 0.3) => {
  const e = createEnemy('e1', spec('schooner'), x, 0, 0);
  e.hp = e.maxHp * hpShare;
  return e;
};

describe('who can be boarded', () => {
  const me = createPlayerShip(0, 0, 0);

  it('a crippled, slow enemy alongside', () => {
    expect(findPrize(me, brig, [crippled(25)], 160)?.id).toBe('e1');
  });

  it('not a healthy one, not a far one, not a fast-moving one, not a sinking one', () => {
    expect(findPrize(me, brig, [crippled(25, 0.9)], 160)).toBeNull();
    expect(findPrize(me, brig, [crippled(25 + 200)], 160)).toBeNull();
    const fast = crippled(25);
    fast.ship.speed = 9;
    expect(findPrize(me, brig, [fast], 160)).toBeNull();
    const going = crippled(25);
    going.sinking = 1;
    expect(findPrize(me, brig, [going], 160)).toBeNull();
  });

  it('a fleeing enemy counts even above the hull threshold; no crew, no party', () => {
    const runner = crippled(25, 0.9);
    runner.fleeing = true;
    expect(findPrize(me, brig, [runner], 160)).not.toBeNull();
    expect(findPrize(me, brig, [crippled(25)], 0)).toBeNull();
  });

  it('picks the nearest of several', () => {
    const near = crippled(15);
    near.id = 'near';
    expect(findPrize(me, brig, [crippled(30), near], 160)?.id).toBe('near');
  });
});

describe('the fight', () => {
  it('a big party beats a small crew, a small one loses everything, and it is repeatable', () => {
    const big = resolveBoarding(140, 40, createRng(1));
    expect(big.won).toBe(true);
    expect(big.lossShare).toBeGreaterThan(0);
    expect(big.lossShare).toBeLessThan(0.5);
    const small = resolveBoarding(20, 120, createRng(1));
    expect(small).toEqual({ won: false, lossShare: 1 });
    expect(resolveBoarding(140, 40, createRng(1))).toEqual(big);
  });

  it('odds follow the balance of strength', () => {
    expect(boardingOdds(100, 100)).toBeCloseTo(0.5);
    expect(boardingOdds(200, 100)).toBeGreaterThan(0.75);
    expect(boardingOdds(0, 100)).toBe(0);
  });

  it('damage thins the enemy crew; the party is part of the company', () => {
    expect(enemyCrewOf(brig, 0.1)).toBeLessThan(enemyCrewOf(brig, 1));
    expect(partyHeads(100)).toBeLessThan(100);
  });
});

describe('loot', () => {
  it('pays by the prize, fits the hold, and is repeatable', () => {
    const a = lootOf(brig, 1, 100, createRng(7));
    expect(a.gold).toBeGreaterThanOrEqual(Math.round(brig.stats.price * 1000 * BOARDING.lootShare * 0.5));
    expect(Object.values(a.goods).reduce((n, q) => n + q, 0)).toBeLessThanOrEqual(100);
    expect(lootOf(brig, 1, 100, createRng(7))).toEqual(a);
    expect(lootOf(brig, 1, 0, createRng(7)).goods).toEqual({});
    expect(lootOf(brig, 2, 100, createRng(7)).gold).toBe(a.gold * 2);
  });
});

describe('in the game', () => {
  const alongside = (crew?: number) => {
    const game = createGame(brig);
    const foe = game.view().enemies[0]!;
    game.dev.damageEnemies(0.3);
    game.dev.teleportPlayer(foe.x + 15, foe.z);
    if (crew !== undefined) game.dev.setCrew(crew);
    return game;
  };

  it('boarding a crippled enemy takes gold and goods, a kill, experience, and sinks the prize', () => {
    const game = alongside();
    expect(game.view().boarding.available).toBe(true);
    const before = game.view();
    game.update(DT, { ...idle, board: true });
    const v = game.view();
    expect(v.events.some((e) => e.type === 'boarded' && e.won)).toBe(true);
    expect(v.captain.gold).toBeGreaterThan(before.captain.gold);
    expect(v.captain.xp).toBeGreaterThan(0);
    expect(v.captain.kills).toBe(1);
    expect(v.kills).toBe(1);
    expect(v.enemies[0]!.sinking).toBeGreaterThanOrEqual(0);
    expect(v.cargo.used).toBeLessThanOrEqual(v.cargo.capacity);
    expect(v.company.count).toBeLessThanOrEqual(before.company.count);
  });

  it('a beaten party loses its crew and must wait before trying again', () => {
    const game = alongside(10);
    game.update(DT, { ...idle, board: true });
    const v = game.view();
    expect(v.events.some((e) => e.type === 'boarded' && e.won === false)).toBe(true);
    expect(v.company.count).toBeLessThan(10);
    expect(v.captain.gold).toBe(2000);
    expect(v.boarding.available).toBe(false);
    expect(v.boarding.cooldown).toBeGreaterThan(0);
  });

  it('cannot board a healthy enemy', () => {
    const game = createGame(brig);
    const foe = game.view().enemies[0]!;
    game.dev.teleportPlayer(foe.x + 15, foe.z);
    game.update(DT, { ...idle, board: true });
    expect(game.view().events.some((e) => e.type === 'boarded')).toBe(false);
  });

  it('a short crew reloads slower and the HUD bar follows', () => {
    const game = createGame(brig);
    game.dev.setCrew(brig.stats.crew / 2);
    expect(game.view().ship.reloadSeconds).toBeCloseTo(12);
    game.update(DT, { ...idle, firePort: true });
    const bar = game.view().ship.reload.port;
    expect(bar).toBeGreaterThan(0.9);
    expect(bar).toBeLessThanOrEqual(1);
  });

  it('a sunk captain keeps the experience but loses cargo and a quarter of the gold', () => {
    const game = createGame(brig);
    game.dev.addXp(50);
    game.dev.setGold(1000);
    game.dev.damageEnemies(1);
    game.dev.setAffliction(1, 0);
    // Sink the player: drain the hull by flooding until it is lost, then restart.
    for (let i = 0; i < 60 * 600 && !game.view().sunk; i++) game.update(DT, idle);
    expect(game.view().sunk).toBe(true);
    for (let i = 0; i < 60 * 3; i++) game.update(DT, { ...idle, restart: true });
    const v = game.view();
    expect(v.sunk).toBe(false);
    expect(v.captain.gold).toBe(750);
    expect(v.captain.xp).toBe(50);
    expect(v.cargo.used).toBe(0);
  });
});
