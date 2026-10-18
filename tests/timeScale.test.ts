import { describe, expect, it } from 'vitest';
import type { GameView } from '../src/core';
import { DANGER_RANGE, SPEEDS, effectiveSpeed, stepSpeed } from '../src/app/timeScale';

const calm = { sunk: false, grounded: false, boarding: { available: false }, balls: [], enemies: [] } as unknown as GameView;
const withEnemy = (distance: number, sinking = -1): GameView => ({ ...calm, enemies: [{ distance, sinking }] }) as unknown as GameView;

describe('game speed', () => {
  it('steps through 1, 2, 3, 5, 10 and stops at both ends', () => {
    expect([...SPEEDS]).toEqual([1, 2, 3, 5, 10]);
    let s = 1;
    const up: number[] = [];
    for (let i = 0; i < 6; i++) up.push((s = stepSpeed(s, 1)));
    expect(up).toEqual([2, 3, 5, 10, 10, 10]);
    const down: number[] = [];
    for (let i = 0; i < 6; i++) down.push((s = stepSpeed(s, -1)));
    expect(down).toEqual([5, 3, 2, 1, 1, 1]);
  });

  it('runs at the requested speed on a calm sea', () => {
    expect(effectiveSpeed(10, calm)).toEqual({ speed: 10, reason: null });
    expect(effectiveSpeed(5, null)).toEqual({ speed: 1, reason: null });
    expect(effectiveSpeed(1, calm)).toEqual({ speed: 1, reason: null });
  });

  it('falls back to 1x with a reason for enemies near, shots in flight, boarding, grounding and sinking', () => {
    expect(effectiveSpeed(5, withEnemy(DANGER_RANGE - 1))).toEqual({ speed: 1, reason: 'enemy' });
    expect(effectiveSpeed(5, withEnemy(DANGER_RANGE + 1)).speed).toBe(5);
    expect(effectiveSpeed(5, withEnemy(100, 3)).speed).toBe(5); // a wreck is no danger
    expect(effectiveSpeed(5, { ...calm, balls: [{}] } as unknown as GameView).reason).toBe('shot');
    expect(effectiveSpeed(5, { ...calm, boarding: { available: true } } as unknown as GameView).reason).toBe('boarding');
    expect(effectiveSpeed(5, { ...calm, grounded: true } as unknown as GameView).reason).toBe('grounded');
    expect(effectiveSpeed(5, { ...calm, sunk: true } as unknown as GameView).reason).toBe('sunk');
  });
});
