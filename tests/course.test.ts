import { describe, expect, it } from 'vitest';
import { COURSE, angleDiff, followCourse, type Track } from '../src/core';
import { createNpcFleet } from '../src/gameplay/npcShips';

describe('followCourse', () => {
  it('takes the intended heading the first time, and after a jump', () => {
    expect(followCourse(undefined, 5, 5, 1.2, 1 / 60)).toEqual({ x: 5, z: 5, heading: 1.2 });
    const t: Track = { x: 0, z: 0, heading: 0.3 };
    expect(followCourse(t, 500, 0, 1.2, 1 / 60).heading).toBe(1.2);
  });

  it('keeps the intended heading while the ship is hardly moving', () => {
    let t: Track = { x: 0, z: 0, heading: 0 };
    for (let i = 0; i < 600; i++) t = followCourse(t, 0, 0, 1, 1 / 60);
    expect(t.heading).toBeCloseTo(1, 3);
  });

  it('follows the way the ship really moves, at a limited turn rate', () => {
    // sailing straight along +z (course -π/2) with the bow pointing along +x: the bow swings round at the turn rate
    let t: Track = { x: 0, z: 0, heading: 0 };
    let last = t.heading;
    let biggest = 0;
    for (let i = 1; i <= 600; i++) {
      t = followCourse(t, 0, i * 0.08, 0, 1 / 60); // 4.8 m/s
      biggest = Math.max(biggest, Math.abs(angleDiff(t.heading, last)));
      last = t.heading;
    }
    expect(biggest).toBeLessThanOrEqual(COURSE.turnRate / 60 + 1e-9);
    expect(Math.abs(angleDiff(t.heading, -Math.PI / 2))).toBeLessThan(1e-6);
  });
});

describe('the patrols and merchants', () => {
  it('point where they go, even when the patrols are steered round another ship (no crabbing)', () => {
    const dt = 1 / 20;
    // a ship that gives them no way lies where the first patrol will be 30 s in: it has to sheer off round it
    const rail = createNpcFleet({ x: 0, z: 0 });
    for (let i = 0; i < 30 / dt; i++) rail.update(dt);
    const there = rail.view()[0]!;
    const block = [{ x: there.x, z: there.z + 12, length: 40 }]; // (a little off the rail: dead on it the push has no direction)
    const fleet = createNpcFleet({ x: 0, z: 0 });
    let prev = fleet.view(undefined, block);
    let worst = 0;
    let sheered = 0;
    for (let i = 1; i < 20 * 60; i++) {
      fleet.update(dt);
      const now = fleet.view(undefined, block);
      for (const o of now) {
        const p = prev.find((q) => q.id === o.id);
        if (!p || o.id >= fleet.firstMerchantId) continue;
        const dx = o.x - p.x;
        const dz = o.z - p.z;
        if (i < 20 || Math.hypot(dx, dz) / dt < 3.5) continue; // (the first second is a blocker dropped in among them; creeping is not sliding)
        const slip = Math.abs(angleDiff(Math.atan2(-dz, dx), o.heading));
        if (slip > COURSE.astern) continue; // shoved astern: the bow keeps its heading by design
        worst = Math.max(worst, slip);
      }
      const a = now[0]!;
      if (Math.hypot(a.x - there.x, a.z - there.z) < 90) sheered++;
      prev = now;
    }
    expect(sheered).toBeGreaterThan(20); // the patrol did come near the blocker
    expect(worst).toBeLessThan(1.4); // under 80° even when pushed hard aside; without the course follow a push slides a ship at any angle to its bow
  });
});

describe('the merchants', () => {
  it('never snap their bows round: from casting off to coming alongside the heading turns at a realistic pace', () => {
    const dt = 1 / 10;
    const fleet = createNpcFleet({ x: 0, z: 0 });
    let prev = fleet.view(undefined, []);
    let worst = 0;
    let moved = 0;
    for (let i = 1; i < 10 * 60 * 25; i++) {
      fleet.update(dt);
      const now = fleet.view(undefined, []);
      for (const o of now) {
        const p = prev.find((q) => q.id === o.id);
        if (!p || Math.hypot(o.x - p.x, o.z - p.z) > COURSE.jump) continue; // (a jump is a respawn)
        if (o.id >= fleet.firstMerchantId) moved++;
        worst = Math.max(worst, Math.abs(angleDiff(o.heading, p.heading)) / dt);
      }
      prev = now;
    }
    expect(moved).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(COURSE.turnRate + 1e-6);
  });
});
