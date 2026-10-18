import { describe, expect, it } from 'vitest';
import { angleDiff, clamp, createInput, lerp, smoothstep, wrapAngle } from '../src/core';

describe('math', () => {
  it('wraps angles into [-π, π]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 5);
    expect(wrapAngle(-3 * Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(7)).toBeCloseTo(7 - 2 * Math.PI);
  });

  it('gives the shortest signed angle difference', () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(0.2);
    expect(angleDiff(-3, 3)).toBeCloseTo(2 * Math.PI - 6);
  });

  it('clamps, lerps and smoothsteps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(lerp(2, 4, 0.5)).toBe(3);
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});

describe('createInput', () => {
  const key = (type: string, code: string, repeat = false): Event =>
    Object.assign(new Event(type), { code, repeat });

  it('tracks held keys and one-shot presses', () => {
    const target = new EventTarget();
    const input = createInput(target as unknown as Window);
    target.dispatchEvent(key('keydown', 'KeyW'));
    expect(input.isDown('KeyW')).toBe(true);
    expect(input.pressed('KeyW')).toBe(true);

    input.endFrame();
    expect(input.isDown('KeyW')).toBe(true);
    expect(input.pressed('KeyW')).toBe(false);

    target.dispatchEvent(key('keyup', 'KeyW'));
    expect(input.isDown('KeyW')).toBe(false);
    input.dispose();
  });

  it('ignores auto-repeat as new presses', () => {
    const target = new EventTarget();
    const input = createInput(target as unknown as Window);
    target.dispatchEvent(key('keydown', 'KeyS'));
    input.endFrame();
    target.dispatchEvent(key('keydown', 'KeyS', true));
    expect(input.pressed('KeyS')).toBe(false);
    input.dispose();
  });

  it('releases all keys on blur and stops listening after dispose', () => {
    const target = new EventTarget();
    const input = createInput(target as unknown as Window);
    target.dispatchEvent(key('keydown', 'KeyA'));
    target.dispatchEvent(new Event('blur'));
    expect(input.isDown('KeyA')).toBe(false);

    input.dispose();
    target.dispatchEvent(key('keydown', 'KeyD'));
    expect(input.isDown('KeyD')).toBe(false);
  });
});
