import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core';
import { createDesk } from '../src/gameplay/desk';
import { createEnemy } from '../src/gameplay/enemy';
import { createPlayerShip } from '../src/gameplay/sailing';
import { newGameState } from '../src/gameplay/state';
import { getShipSpec } from '../src/ships';

const brig = getShipSpec('brig')!;

describe('desk', () => {
  it('carries the fractions of sailors lost, so many small hits add up', () => {
    const st = newGameState(brig);
    const desk = createDesk(st, () => brig);
    for (let i = 0; i < 10; i++) desk.loseCrew(25, brig.stats.hp, 'hull'); // 0.96 of a sailor each
    expect(st.crew).toBe(brig.stats.crew - 9);
  });

  it('never loses more crew than there is', () => {
    const st = newGameState(brig);
    st.crew = 2;
    createDesk(st, () => brig).loseCrew(1e6, brig.stats.hp, 'hull');
    expect(st.crew).toBe(0);
  });

  it('a lost boarding starts the cooldown, which ticks down', () => {
    const st = newGameState(brig);
    st.crew = 10;
    const desk = createDesk(st, () => brig);
    const foe = createEnemy('e1', getShipSpec('galleon')!, 15, 0, 0);
    foe.hp = foe.maxHp * 0.3;
    const events: never[] = [];
    expect(desk.attempt(createPlayerShip(0, 0, 0), [foe], createRng(1), events)).toBeNull();
    expect(desk.cooldown()).toBeGreaterThan(0);
    expect(desk.attempt(createPlayerShip(0, 0, 0), [foe], createRng(1), events)).toBeNull(); // too soon: nothing happens
    const crew = st.crew;
    desk.tick(100);
    expect(desk.cooldown()).toBe(0);
    desk.attempt(createPlayerShip(0, 0, 0), [foe], createRng(1), events);
    expect(st.crew).toBeLessThanOrEqual(crew);
  });

  it('the price of going down', () => {
    const st = newGameState(brig);
    st.captain.gold = 1001;
    st.hold = { rum: 5 };
    st.crew = 3;
    createDesk(st, () => brig).sunkPenalty();
    expect(st.captain.gold).toBe(750);
    expect(st.hold).toEqual({});
    expect(st.crew).toBe(Math.ceil(brig.stats.crew / 2));
  });
});
