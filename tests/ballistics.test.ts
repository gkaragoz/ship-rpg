import { describe, expect, it } from 'vitest';
import { getShipSpec } from '../src/ships';
import { COMBAT, ballSpeed, fireBroadside, hitChanceAt, hitNormal, ricochet, stepBall, windVelocity, type Ball } from '../src/gameplay/combat';
import { createDebris } from '../src/render/debris';

const brig = (() => {
  const s = getShipSpec('brig');
  if (!s) throw new Error('no brig');
  return s;
})();

const ball = (over: Partial<Ball> = {}): Ball => ({ id: 1, owner: 'player', x: 0, y: 3, z: 0, vx: 90, vy: 7, vz: 0, damage: 100, age: 0, ...over });

const fly = (b: Ball, air?: { x: number; z: number }): Ball => {
  for (let i = 0; i < 600 && b.y > 0; i++) stepBall(b, 1 / 120, air);
  return b;
};

describe('flight', () => {
  it('slows a ball with air drag, and falls short of a drag-free flight', () => {
    const b = fly(ball());
    expect(ballSpeed(b)).toBeLessThan(90);
    const saved = COMBAT.drag;
    COMBAT.drag = 0;
    try {
      expect(b.x).toBeLessThan(fly(ball()).x);
    } finally {
      COMBAT.drag = saved;
    }
  });

  it('is pushed by the wind: a crosswind moves the landing sideways, a headwind shortens it', () => {
    const calm = fly(ball());
    const cross = fly(ball(), { x: 0, z: 15 });
    expect(cross.z).toBeGreaterThan(calm.z + 0.2);
    const head = fly(ball(), { x: -15, z: 0 });
    expect(head.x).toBeLessThan(calm.x);
  });

  it('blows the air towards where the wind is going', () => {
    const w = windVelocity({ from: 0, speed: 10 }); // from the bow direction: blows backwards
    expect(w.x).toBeCloseTo(-10);
    expect(Math.abs(w.z)).toBeLessThan(1e-9);
  });

  it('has a chance of a hit at close range and none far beyond the range (the aim zone is tabulated from the same flight)', () => {
    expect(hitChanceAt(brig, 100)).toBeGreaterThan(0);
    expect(hitChanceAt(brig, 600)).toBe(0);
  });
});

describe('the sea', () => {
  it('skips a ball that comes in flat and fast, losing speed and damage, and sinks one that comes in steep', () => {
    const flat = ball({ y: -0.1, vx: 88, vy: -7 });
    expect(ricochet(flat, 0)).toBe(true);
    expect(flat.vy).toBeGreaterThan(0);
    expect(flat.damage).toBeLessThan(100);
    expect(flat.vx).toBeLessThan(88);
    const steep = ball({ y: -0.1, vx: 30, vy: -40 });
    expect(ricochet(steep, 0)).toBe(false);
    const slow = ball({ y: -0.1, vx: 30, vy: -2 });
    expect(ricochet(slow, 0)).toBe(false);
  });

  it('skips at most twice', () => {
    const b = ball({ y: -0.1, vx: 90, vy: -6 });
    let skips = 0;
    for (let i = 0; i < 6; i++) {
      b.vy = -6;
      b.vx = 90;
      b.y = -0.1;
      if (ricochet(b, 0)) skips++;
    }
    expect(skips).toBe(2);
  });
});

describe('hits and shots', () => {
  it('gives the outward normal of the side that was struck', () => {
    const target = { x: 0, z: 0, heading: 0 }; // facing +x; starboard is +z
    const star = hitNormal(ball({ x: 2, z: 3 }), target);
    const port = hitNormal(ball({ x: 2, z: -3 }), target);
    expect([star.x + 0, star.z]).toEqual([0, 1]);
    expect([port.x + 0, port.z]).toEqual([0, -1]);
  });

  it('tells the muzzle blast which way the gun points', () => {
    let id = 0;
    const { events } = fireBroadside('player', { x: 0, z: 0, heading: 0, speed: 0 }, brig, 'starboard', () => 0.5, () => ++id);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.nz).toBeCloseTo(1); // starboard of a ship facing +x is +z
      expect(Math.abs(e.nx ?? 1)).toBeLessThan(1e-9);
    }
  });
});

describe('debris', () => {
  const flatSea = (): number => 0;

  it('flies, lands on the sea, floats and then sinks away', () => {
    const d = createDebris({ props: false });
    d.launch({ kind: 'plank', x: 0, y: 3, z: 0, vx: 4, vy: 6, vz: 0 });
    expect(d.count()).toBe(0); // counted on the first update
    d.update(0.016, flatSea, 0, 0);
    expect(d.count()).toBe(1);
    for (let i = 0; i < 120; i++) d.update(1 / 60, flatSea, 0, 0); // 2 s: it has landed
    expect(d.count()).toBe(1);
    for (let i = 0; i < 60 * 14; i++) d.update(1 / 60, flatSea, 0, 0); // well past the float time
    expect(d.count()).toBe(0);
    d.dispose();
  });

  it('recycles the oldest piece when the pool is full and thins out with the particle setting', () => {
    const d = createDebris({ props: false });
    for (let i = 0; i < 400; i++) d.launch({ kind: 'splinter', x: 0, y: 5, z: 0, vx: 0, vy: 0, vz: 0 });
    d.update(0.016, flatSea, 0, 0);
    expect(d.count()).toBeLessThanOrEqual(150);
    const thin = createDebris({ props: false });
    thin.setDensity(0.25);
    for (let i = 0; i < 400; i++) thin.launch({ kind: 'splinter', x: 0, y: 5, z: 0, vx: 0, vy: 0, vz: 0 });
    thin.update(0.016, flatSea, 0, 0);
    expect(thin.count()).toBeLessThan(d.count());
    d.dispose();
    thin.dispose();
  });
});
