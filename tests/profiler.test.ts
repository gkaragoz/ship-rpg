import { describe, expect, it } from 'vitest';
import { HISTORY, createProfiler, frameColor } from '../src/core/profiler';

describe('profiler', () => {
  it('measures frame times between calls', () => {
    const p = createProfiler();
    for (let i = 0; i <= 60; i++) p.frame(i * 16);
    const s = p.stats();
    expect(s.frames).toBe(60);
    expect(s.avgMs).toBeCloseTo(16);
    expect(s.fps).toBeCloseTo(62.5);
    expect(s.worstMs).toBeCloseTo(16);
    expect(s.p95Ms).toBeCloseTo(16);
  });

  it('shows a slow spike in the 1 % low and the worst frame but hardly in the average', () => {
    const p = createProfiler();
    let t = 0;
    p.frame(t);
    for (let i = 0; i < 119; i++) p.frame((t += 10));
    p.frame((t += 200)); // one hitch
    const s = p.stats();
    expect(s.worstMs).toBeCloseTo(200);
    expect(s.lowFps).toBeLessThan(10); // the slowest 1 % of 120 frames is 2 frames: the hitch and one normal one
    expect(s.fps).toBeGreaterThan(60);
    expect(s.avgMs).toBeLessThan(12);
  });

  it('keeps only the latest frames, oldest first, and ignores stalls', () => {
    const p = createProfiler();
    let t = 0;
    p.frame(t);
    for (let i = 0; i < HISTORY + 30; i++) p.frame((t += 5 + (i % 3)));
    expect(p.recent()).toHaveLength(HISTORY);
    p.frame((t += 5000)); // the tab was hidden
    expect(p.stats().worstMs).toBeLessThan(10);
  });

  it('times sections and averages them per frame, resetting after each read', () => {
    let clock = 0;
    const p = createProfiler(() => clock);
    p.frame(0);
    for (let f = 1; f <= 4; f++) {
      p.begin('update');
      clock += 2;
      p.end('update');
      p.begin('render');
      clock += 5;
      p.begin('nested'); // overlapping sections are fine
      clock += 1;
      p.end('nested');
      p.end('render');
      p.begin('update'); // the same section twice in a frame adds up
      clock += 1;
      p.end('update');
      p.frame(f * 16);
    }
    const s = p.stats();
    expect(s.sections.update).toBeCloseTo(3);
    expect(s.sections.render).toBeCloseTo(6);
    expect(s.sections.nested).toBeCloseTo(1);
    expect(p.stats().sections).toEqual({});
  });

  it('survives an end without a begin and an empty history, and resets', () => {
    const p = createProfiler();
    p.end('never begun');
    expect(p.stats()).toMatchObject({ fps: 0, lowFps: 0, frames: 0 });
    p.frame(0);
    p.frame(16);
    p.reset();
    expect(p.stats().frames).toBe(0);
    expect(p.recent()).toHaveLength(0);
  });

  it('colours slow frames amber and red', () => {
    expect(frameColor(8)).toBe('#4cc35b');
    expect(frameColor(20)).toBe('#e6b73a');
    expect(frameColor(40)).toBe('#e0463b');
  });
});
