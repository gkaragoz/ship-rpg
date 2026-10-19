import { describe, expect, it } from 'vitest';
import { createGame } from '../src/gameplay';
import { tradePrice } from '../src/gameplay/harbour';
import { PRICE, REP, addStanding, enemyNationFor, fadeStanding, portClosed, recordKill, standing } from '../src/gameplay/reputation';
import { parseSave, sanitizeState, serializeSave } from '../src/gameplay/save';
import { newGameState } from '../src/gameplay/state';
import { NAVIES, NATIONS, PORTS, REPUTATION, START_REPUTATION, atWar, enemiesOf } from '../src/world';
import { getShipSpec } from '../src/ships';

const brig = getShipSpec('brig')!;
const fresh = () => newGameState(brig);

describe('who is at war', () => {
  it('is symmetrical, never with oneself or the free captain, and everybody against pirates', () => {
    for (const a of NATIONS) {
      expect(atWar(a.id, a.id)).toBe(false);
      expect(atWar(a.id, 'free')).toBe(false);
      for (const b of NATIONS) expect(atWar(a.id, b.id), `${a.id}/${b.id}`).toBe(atWar(b.id, a.id));
    }
    for (const n of NAVIES) expect(atWar(n, 'pirate')).toBe(true);
    expect(atWar('english', 'french')).toBe(true);
    expect(atWar('english', 'dutch')).toBe(false);
    expect(enemiesOf('spanish').sort()).toEqual(['dutch', 'english']);
  });

  it('starts every nation of the list with a standing in range, with Spain hostile and the home port friendly', () => {
    for (const n of NATIONS) {
      expect(START_REPUTATION[n.id]).toBeDefined();
      expect(START_REPUTATION[n.id]).toBeGreaterThanOrEqual(REPUTATION.min);
      expect(START_REPUTATION[n.id]).toBeLessThanOrEqual(REPUTATION.max);
    }
    expect(START_REPUTATION.spanish).toBeLessThanOrEqual(REP.hostile);
    expect(START_REPUTATION.dutch).toBeGreaterThan(0);
  });
});

describe('standing', () => {
  it('falls with the flag of every ship sunk or taken, and rises with its enemies', () => {
    const st = fresh();
    const before = { ...st.reputation };
    recordKill(st, 'spanish');
    expect(standing(st, 'spanish')).toBe(before.spanish! - REP.killPenalty);
    expect(standing(st, 'english')).toBe(before.english! + REP.enemyBonus);
    expect(standing(st, 'dutch')).toBe(before.dutch! + REP.enemyBonus);
    expect(standing(st, 'french')).toBe(before.french);
  });

  it('rises with every navy when a pirate is sunk, and never moves for the free flag', () => {
    const st = fresh();
    const before = { ...st.reputation };
    recordKill(st, 'pirate');
    expect(standing(st, 'pirate')).toBe(before.pirate! - REP.killPenalty);
    for (const n of NAVIES) expect(standing(st, n)).toBe(before[n]! + REP.pirateBonus);
    const copy = { ...st.reputation };
    recordKill(st, 'free');
    expect(st.reputation).toEqual(copy);
  });

  it('stays between -100 and 100', () => {
    const st = fresh();
    for (let i = 0; i < 40; i++) recordKill(st, 'spanish');
    expect(standing(st, 'spanish')).toBe(REPUTATION.min);
    for (let i = 0; i < 80; i++) addStanding(st, 'english', 10);
    expect(standing(st, 'english')).toBe(REPUTATION.max);
  });

  it('fades towards zero with time, a point at a time, from either side', () => {
    const st = fresh();
    st.reputation.english = 4;
    st.reputation.spanish = -3;
    const clock = { t: 0 };
    fadeStanding(st, clock, REP.fadeEvery - 1);
    expect(st.reputation.english).toBe(4);
    fadeStanding(st, clock, 1);
    expect(st.reputation.english).toBe(3);
    expect(st.reputation.spanish).toBe(-2);
    fadeStanding(st, clock, REP.fadeEvery * 10);
    expect(st.reputation.english).toBe(0);
    expect(st.reputation.spanish).toBe(0);
  });
});

describe('ports and enemies follow it', () => {
  it('shuts a navy port on a hated captain, never a pirate or free one', () => {
    const st = fresh();
    for (const port of PORTS) expect(portClosed(st, port), port.id).toBe(false);
    for (const n of NATIONS) st.reputation[n.id] = REP.portClosed;
    for (const port of PORTS) expect(portClosed(st, port), port.id).toBe((NAVIES as readonly string[]).includes(port.nation));
    st.reputation.dutch = REP.portClosed + 1;
    expect(portClosed(st, PORTS.find((p) => p.nation === 'dutch')!)).toBe(false);
  });

  it('sends pirates always and the navies hunting the captain, in turn', () => {
    const st = fresh();
    expect([0, 1, 2, 3].map((i) => enemyNationFor(st, i))).toEqual(['pirate', 'spanish', 'pirate', 'spanish']);
    st.reputation.spanish = 0;
    expect([0, 1, 2].map((i) => enemyNationFor(st, i))).toEqual(['pirate', 'pirate', 'pirate']);
    st.reputation.french = REP.hostile;
    st.reputation.english = REP.hostile;
    expect([0, 1, 2, 3].map((i) => enemyNationFor(st, i))).toEqual(['pirate', 'english', 'french', 'pirate']);
  });

  it('refuses the entry of a closed port in the game, and says so in the view', () => {
    const state = fresh();
    state.reputation.dutch = REP.portClosed; // Douwesen, the start port, is Dutch
    const game = createGame(state);
    const v = game.view();
    expect(v.nearestPort?.id).toBe('douwesen');
    expect(v.nearestPort?.inZone).toBe(true);
    expect(v.nearestPort?.closed).toBe(true);
    expect(v.nearestPort?.dockable).toBe(false);
    game.update(1 / 60, { rudder: 0, sailStep: 0, interact: true });
    expect(game.view().docked).toBeNull();
  });

  it('lowers the standing with the flag of an enemy sunk in the game', () => {
    const game = createGame(fresh());
    const foe = game.view().enemies[0]!;
    const before = game.view().reputation[foe.nation]!;
    game.dev.damageEnemies(0.0001);
    game.dev.teleportPlayer(foe.x + 60, foe.z);
    for (let i = 0; i < 60 * 120 && game.view().reputation[foe.nation] === before; i++) {
      game.update(1 / 60, { rudder: 0, sailStep: 0, firePort: i % 480 === 0, fireStarboard: i % 480 === 240 });
    }
    if (game.view().kills > 0) expect(game.view().reputation[foe.nation]).toBeLessThan(before);
  });
});

describe('standing in a save', () => {
  it('survives a round trip, is clamped, and unknown nations are dropped', () => {
    const st = fresh();
    st.reputation.english = 55;
    st.reputation.french = -80;
    const back = parseSave(serializeSave(st, '2026-01-01T00:00:00Z'));
    expect(back.ok && back.state.reputation).toEqual(st.reputation);
    const dirty = sanitizeState({ ...st, reputation: { english: 9999, french: -9999, martian: 5, dutch: 'x' } });
    expect(dirty?.reputation.english).toBe(REPUTATION.max);
    expect(dirty?.reputation.french).toBe(REPUTATION.min);
    expect(dirty?.reputation.dutch).toBe(START_REPUTATION.dutch);
    expect(dirty?.reputation.martian).toBeUndefined();
    expect(sanitizeState({ ...st, reputation: 'nonsense' })?.reputation).toEqual(START_REPUTATION);
  });
});

describe('standing moves prices', () => {
  const dutch = PORTS.find((p) => p.nation === 'dutch')!;
  const pirate = PORTS.find((p) => p.nation === 'pirate')!;

  it('treats a friend better and a hated captain worse in a navy port, and nobody differently in a pirate port', () => {
    const st = fresh();
    const base = (side: 'buy' | 'sell') => tradePrice(st, dutch.id, 'rum', 1, side, 0);
    const neutral = { buy: base('buy'), sell: base('sell') };
    st.reputation.dutch = PRICE.friend;
    expect(base('buy')).toBeCloseTo(neutral.buy * PRICE.buyFriend, 6);
    expect(base('sell')).toBeCloseTo(neutral.sell * PRICE.sellFriend, 6);
    st.reputation.dutch = REP.hostile;
    expect(base('buy')).toBeCloseTo(neutral.buy * PRICE.buyHostile, 6);
    expect(base('sell')).toBeCloseTo(neutral.sell * PRICE.sellHostile, 6);
    const pirates = tradePrice(st, pirate.id, 'rum', 1, 'buy', 0);
    st.reputation.pirate = -90;
    expect(tradePrice(st, pirate.id, 'rum', 1, 'buy', 0)).toBe(pirates);
  });

  it('never lets a round trip in one port make money, whatever the standing', () => {
    const st = fresh();
    for (const v of [-45, -20, 0, 39, 40, 100]) {
      st.reputation.dutch = v;
      const buy = tradePrice(st, dutch.id, 'silk', 1, 'buy', 0);
      const sell = tradePrice(st, dutch.id, 'silk', 1, 'sell', 0);
      expect(sell, `standing ${v}`).toBeLessThan(buy);
    }
  });
});
