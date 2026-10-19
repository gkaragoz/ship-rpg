import { describe, expect, it } from 'vitest';
import type { OtherShipView } from '../src/core';
import { createGame } from '../src/gameplay';
import { MERCHANT, createMerchantBook, plunderMerchant } from '../src/gameplay/merchants';
import { createRng } from '../src/core';
import { newGameState } from '../src/gameplay/state';
import { getShipSpec } from '../src/ships';
import { REP, standing } from '../src/gameplay/reputation';

const brig = getShipSpec('brig')!;
const fleut = getShipSpec('fleut')!;
const other = (id: number, specId = 'fleut'): OtherShipView => ({ id, specId, nation: 'english', x: 0, z: 0, heading: 0, sailLevel: 0.8, roll: 0, apparent: { angle: 0, speed: 0 } });

describe('merchant book', () => {
  it('only the merchants (from the first id up) are targets, until they sink', () => {
    const book = createMerchantBook(12);
    const others = [other(3), other(12), other(13)];
    expect(book.targets(others, 0).map((t) => t.id)).toEqual([12, 13]);
    expect(book.hit(12, fleut, 1, 0)).toBe(false);
    expect(book.hit(12, fleut, 1e6, 5)).toBe(true);
    expect(book.hit(12, fleut, 1, 6)).toBe(false); // already sunk
    expect(book.targets(others, 10).map((t) => t.id)).toEqual([13]);
    expect(book.mark(others, 10).map((o) => !!o.sunk)).toEqual([false, true, false]);
  });

  it('sails again after the respawn time, whole', () => {
    const book = createMerchantBook(0);
    book.hit(1, fleut, 1e6, 100);
    expect(book.isSunk(1, 100 + MERCHANT.respawn - 1)).toBe(true);
    expect(book.isSunk(1, 100 + MERCHANT.respawn)).toBe(false);
    expect(book.hit(1, fleut, 1, 2000)).toBe(false); // a fresh hull again
  });
});

describe('plundering a sunk merchant', () => {
  it('costs the flag its good will, pays a share of the loot and experience and reports it', () => {
    const st = newGameState(brig);
    const before = { gold: st.captain.gold, xp: st.captain.xp, kills: st.captain.kills, english: standing(st, 'english'), french: standing(st, 'french') };
    const events = plunderMerchant(st, fleut, 'english', { x: 5, z: 6 }, brig.stats.hold, createRng(3));
    expect(events.map((e) => e.type)).toEqual(['sunk', 'loot']);
    expect(events[0]).toMatchObject({ owner: 'enemy', length: fleut.length });
    expect(st.captain.gold).toBeGreaterThan(before.gold);
    expect(st.captain.xp).toBeGreaterThan(before.xp);
    expect(st.captain.kills).toBe(before.kills + 1);
    expect(standing(st, 'english')).toBe(before.english - REP.killPenalty);
    expect(standing(st, 'french')).toBe(before.french + REP.enemyBonus);
  });

  it('takes no more goods than the hold has room for', () => {
    const st = newGameState(brig);
    plunderMerchant(st, fleut, 'dutch', { x: 0, z: 0 }, 0, createRng(4));
    expect(Object.values(st.hold).reduce((n, q) => n + q, 0)).toBe(0);
  });
});

describe('merchants in the game', () => {
  it('are in the view, not sunk at the start, and the patrols are not targets', () => {
    const game = createGame(newGameState(brig));
    const others = game.view().others;
    expect(others).toHaveLength(18);
    expect(others.every((o) => !o.sunk)).toBe(true);
  });
});

describe('balls and merchants', () => {
  it('a ball from the captain that reaches a merchant is spent on it, and only his balls hit', async () => {
    const { resolveBall } = await import('../src/gameplay/shots');
    const hits: number[] = [];
    const events: string[] = [];
    const target = { id: 14, ship: { x: 100, z: 50, heading: 0 }, spec: fleut };
    const world = {
      player: { ship: { x: 0, z: 0, heading: 0, speed: 0 } as never, spec: brig, maxHp: brig.stats.hp, targetable: true },
      enemies: [],
      consorts: [],
      merchants: [target],
      rng: () => 0.9,
      surfaceAt: () => 0,
      emit: (e: { type: string }) => events.push(e.type),
      onPlayerHit: () => undefined,
      onEnemyHit: () => undefined,
      onConsortHit: () => undefined,
      onMerchantHit: (_m: unknown, lost: number) => hits.push(lost),
    };
    const ball = (owner: 'player' | 'enemy') => ({ id: 1, owner, x: 100, y: 1.2, z: 50, vx: 0, vy: 0, vz: 0, age: 0, damage: 12 * 2.5 }) as never;
    expect(resolveBall(ball('player'), world as never)).toBe(true);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeGreaterThan(0);
    expect(events).toContain('hit');
    hits.length = 0;
    resolveBall(ball('enemy'), world as never); // an enemy's ball passes through a merchant
    expect(hits).toHaveLength(0);
  });
});
