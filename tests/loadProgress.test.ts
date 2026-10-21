import { describe, expect, it } from 'vitest';
import { isLoading, loadFraction, trackLoad } from '../src/core';

const ev = (loaded: number, total: number): ProgressEvent => ({ loaded, total, lengthComputable: true }) as ProgressEvent;

describe('loadProgress', () => {
  it('sums the bytes of concurrent loads and starts over when all are done', () => {
    const a = trackLoad();
    const b = trackLoad();
    a.onProgress(ev(50, 100));
    b.onProgress(ev(0, 100));
    expect(loadFraction()).toBeCloseTo(0.25);
    expect(isLoading()).toBe(true);
    a.done();
    expect(loadFraction()).toBeCloseTo(0.5);
    b.done();
    expect(isLoading()).toBe(false);
    expect(loadFraction()).toBe(1);
  });

  it('counts a file of unknown size as done only when it is', () => {
    const a = trackLoad();
    a.onProgress({ loaded: 10, total: 0, lengthComputable: false } as ProgressEvent);
    expect(loadFraction()).toBe(0);
    a.done();
    expect(loadFraction()).toBe(1);
  });
});
