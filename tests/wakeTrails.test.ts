import { describe, expect, it } from 'vitest';
import { angleDiff } from '../src/core';
import { createWakeTrails } from '../src/render/wakeTrails';

const DT = 1 / 60;

describe('wake trails', () => {
  it('start on the heading and follow the way the ship really moves, leeway included', () => {
    const trails = createWakeTrails();
    expect(trails.step('a', 0, 0, 0, DT).course).toBe(0);
    trails.sweep();
    // the bow points along +x (heading 0) but the ship slips towards +z (course -π/4): after a moment the course shows it
    let course = 0;
    for (let i = 1; i <= 120; i++) {
      course = trails.step('a', i * 0.05, i * 0.05, 0, DT).course;
      trails.sweep();
    }
    expect(Math.abs(angleDiff(course, -Math.PI / 4))).toBeLessThan(0.02);
  });

  it('report where the ship was and how fast it goes over the ground', () => {
    const trails = createWakeTrails();
    trails.step('a', 10, 20, 0, DT);
    trails.sweep();
    const s = trails.step('a', 10.1, 20, 0, DT);
    expect(s.px).toBe(10);
    expect(s.pz).toBe(20);
    expect(s.speed).toBeCloseTo(6, 3);
  });

  it('keep the bow\'s side when the ship is thrown astern, and a heading when it hardly moves', () => {
    const trails = createWakeTrails();
    trails.step('a', 0, 0, 0, DT);
    trails.sweep();
    let course = 0;
    for (let i = 1; i <= 60; i++) {
      course = trails.step('a', -i * 0.05, 0, 0, DT).course; // backing along -x with the bow still to +x
      trails.sweep();
    }
    expect(Math.abs(angleDiff(course, 0))).toBeLessThan(0.02);
    expect(Math.abs(angleDiff(trails.step('a', -3.0001, 0, 1.1, DT).course, course))).toBeLessThan(0.2); // hardly moving: it eases towards the heading, no jump
  });

  it('forget ships that were not seen for a frame, and treat a jump as a new ship', () => {
    const trails = createWakeTrails();
    trails.step('gone', 0, 0, 0.7, DT);
    trails.sweep();
    trails.sweep(); // not stepped this frame
    const back = trails.step('gone', 1, 0, 0.9, DT);
    expect(back.course).toBe(0.9);
    expect(back.speed).toBe(0);
    trails.sweep();
    expect(trails.step('gone', 5000, 5000, 0.3, DT).px).toBe(5000);
  });
});
