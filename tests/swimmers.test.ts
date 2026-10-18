import { describe, expect, it } from 'vitest';
import { DROWN_TIME, FLOAT_DEPTH, SWIM_TIME, flungByHit, spilledBySinking, stepSwimmers, swimRng, throwSailor, type SwimEnv, type Swimmer } from '../src/render/swimmerSim';

const DT = 1 / 60;
const sea = (h = 0): SwimEnv & { splashes: number[] } => {
  const splashes: number[] = [];
  return { splashes, surface: (x) => h + 0.3 * Math.sin(x), splash: (_x, _z, speed) => void splashes.push(speed) };
};

describe('swimmers', () => {
  it('fly, splash once, swim at the surface, then drown and are removed', () => {
    const env = sea();
    const list: Swimmer[] = [throwSailor(0, 6, 0, 3, 5, 0, swimRng(1))];
    const s = list[0] as Swimmer;
    const phases = new Set<string>();
    let t = 0;
    while (list.length && t < 120) {
      stepSwimmers(list, env, DT);
      t += DT;
      phases.add(s.phase);
      if (s.phase === 'swim' && s.t > 3 && s.t < 3.1) {
        // floating: feet below the surface by the float depth, head above it
        expect(s.y).toBeCloseTo(env.surface(s.x, 0) - FLOAT_DEPTH, 0);
      }
    }
    expect([...phases]).toEqual(['fly', 'swim', 'drown']);
    expect(env.splashes).toHaveLength(1);
    expect(env.splashes[0]).toBeGreaterThan(3);
    expect(list).toHaveLength(0);
    expect(t).toBeGreaterThan(SWIM_TIME[0] + DROWN_TIME);
    expect(t).toBeLessThan(SWIM_TIME[1] + DROWN_TIME + 5);
  });

  it('a drowning sailor sinks below the surface before it is removed', () => {
    const env = sea();
    const list: Swimmer[] = [throwSailor(0, 2, 0, 0, 0, 0, swimRng(2))];
    const s = list[0] as Swimmer;
    let deepest = Infinity;
    for (let i = 0; i < 90 / DT && list.length; i++) {
      stepSwimmers(list, env, DT);
      deepest = Math.min(deepest, s.y - env.surface(s.x, 0));
    }
    expect(deepest).toBeLessThan(-FLOAT_DEPTH - 2);
  });

  it('is deterministic for a seed', () => {
    const run = (): number[] => {
      const rand = swimRng(7);
      const list = spilledBySinking(0, 2, 0, 30, 8, rand);
      const env = sea();
      for (let i = 0; i < 600; i++) stepSwimmers(list, env, DT);
      return list.map((s) => s.x + s.z);
    };
    expect(run()).toEqual(run());
  });

  it('a hit flings a sailor away from the ship along the normal', () => {
    const s = flungByHit(0, 3, 0, 1, 0, swimRng(3));
    expect(s.vx).toBeGreaterThan(2);
    expect(Math.abs(s.vz)).toBeLessThan(s.vx);
    expect(s.vy).toBeGreaterThan(3);
  });

  it('a sinking ship spills its sailors around it over a couple of seconds', () => {
    const list = spilledBySinking(10, 2, 20, 40, 12, swimRng(4));
    expect(list).toHaveLength(12);
    for (const s of list) {
      expect(Math.hypot(s.x - 10, s.z - 20)).toBeLessThanOrEqual(40 * 0.35 + 1e-6);
      expect(s.delay).toBeGreaterThanOrEqual(0);
      expect(s.delay).toBeLessThanOrEqual(2);
    }
    expect(new Set(list.map((s) => s.id)).size).toBe(12);
  });

  it('keeps every number finite for a long hitch', () => {
    const list = spilledBySinking(0, 2, 0, 30, 10, swimRng(5));
    const env = sea();
    for (let i = 0; i < 40; i++) stepSwimmers(list, env, 0.5);
    for (const s of list) for (const v of [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.pitch, s.roll]) expect(Number.isFinite(v)).toBe(true);
  });
});
