import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core';
import { mergeHits } from '../src/render/damageNumbers';

const hit = (owner: 'player' | 'enemy', x: number, z: number, amount?: number, type: GameEvent['type'] = 'hit'): GameEvent => ({
  type,
  owner,
  x,
  y: 2,
  z,
  ...(amount === undefined ? {} : { amount }),
});

describe('mergeHits', () => {
  it('adds the hits of one volley on one target into a single number', () => {
    const sums = mergeHits([hit('player', 100, 100, 30), hit('player', 104, 98, 30), hit('player', 96, 103, 30)]);
    expect(sums).toHaveLength(1);
    expect(sums[0]!.amount).toBe(90);
    expect(sums[0]!.x).toBeCloseTo(100, 0);
  });

  it('keeps targets far apart, and our hits and theirs, separate', () => {
    expect(mergeHits([hit('player', 0, 0, 30), hit('player', 200, 0, 30)])).toHaveLength(2);
    expect(mergeHits([hit('player', 0, 0, 30), hit('enemy', 0, 0, 30)])).toHaveLength(2);
  });

  it('ignores events that are not damaging hits', () => {
    expect(mergeHits([hit('player', 0, 0, 30, 'splash'), hit('player', 0, 0), hit('player', 0, 0, 0)])).toHaveLength(0);
    expect(mergeHits([])).toEqual([]);
  });

  it('weights the position by damage', () => {
    const [s] = mergeHits([hit('enemy', 0, 0, 10), hit('enemy', 10, 0, 30)]);
    expect(s!.amount).toBe(40);
    expect(s!.x).toBeCloseTo(7.5, 5);
  });
});
