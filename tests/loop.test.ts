import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG, startLoop } from '../src/core';

describe('CONFIG', () => {
  it('uses a positive fixed step smaller than the frame clamp', () => {
    expect(CONFIG.fixedStep).toBeGreaterThan(0);
    expect(CONFIG.fixedStep).toBeLessThan(CONFIG.maxFrameDelta);
  });
});

describe('startLoop', () => {
  let callbacks: FrameRequestCallback[];
  let now: number;

  beforeEach(() => {
    callbacks = [];
    now = 0;
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => callbacks.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => callbacks.splice(0));
  });
  afterEach(() => vi.unstubAllGlobals());

  const tick = (ms: number): void => {
    now += ms;
    callbacks.splice(0).forEach((cb) => cb(now));
  };

  it('runs whole fixed steps and renders once per frame', () => {
    const update = vi.fn();
    const render = vi.fn();
    startLoop({ update, render });
    tick(CONFIG.fixedStep * 1000 * 3 + 1);
    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenCalledWith(CONFIG.fixedStep);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('clamps long frames to maxFrameDelta', () => {
    const update = vi.fn();
    startLoop({ update, render: vi.fn() });
    tick(10_000);
    expect(update.mock.calls.length).toBeLessThanOrEqual(
      Math.ceil(CONFIG.maxFrameDelta / CONFIG.fixedStep),
    );
  });

  it('stops scheduling frames after stop()', () => {
    const render = vi.fn();
    const stop = startLoop({ update: vi.fn(), render });
    stop();
    tick(100);
    expect(render).not.toHaveBeenCalled();
  });
});
