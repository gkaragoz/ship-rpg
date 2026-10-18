import { describe, expect, it } from 'vitest';
import { angleDiff } from '../src/core';
import { getShipSpec } from '../src/ships';
import { apparentWind, gustAt } from '../src/world';
import { createPlayerShip, stepPlayerShip } from '../src/gameplay/sailing';
import { NO_SEA_EFFECTS } from '../src/gameplay/buoyancy';
import { createGame } from '../src/gameplay';

const wind = { from: Math.PI / 2, speed: 8 }; // from the north (-z), blowing south
const brig = (() => {
  const s = getShipSpec('brig');
  if (!s) throw new Error('no brig');
  return s;
})();
const OPEN = { x: -9000, z: -9000 };
const CALM_SEA = { ...NO_SEA_EFFECTS, lee: 1 };
const NONE = { rudder: 0, sailStep: 0 as const };

describe('gusts', () => {
  it('stay between 0.75 and 1.25, average about 1, and vary from place to place and moment to moment', () => {
    let sum = 0;
    let n = 0;
    let min = 9;
    let max = 0;
    for (let x = -3000; x <= 3000; x += 150) {
      for (let z = -3000; z <= 3000; z += 150) {
        for (const t of [0, 250, 900]) {
          const g = gustAt(x, z, t, wind);
          sum += g;
          n++;
          min = Math.min(min, g);
          max = Math.max(max, g);
        }
      }
    }
    expect(min).toBeGreaterThanOrEqual(0.75);
    expect(max).toBeLessThanOrEqual(1.25);
    expect(max - min).toBeGreaterThan(0.25); // there really are gusts and lulls
    expect(Math.abs(sum / n - 1)).toBeLessThan(0.03);
    expect(gustAt(100, 200, 5, wind)).not.toBe(gustAt(400, 200, 5, wind));
    expect(gustAt(100, 200, 5, wind)).not.toBe(gustAt(100, 200, 45, wind));
    expect(gustAt(100, 200, 5, wind)).toBe(gustAt(100, 200, 5, wind));
  });

  it('drift downwind with the wind: the same gust arrives further along later', () => {
    const t0 = 30;
    const dt = 40;
    const carried = 0.65 * 8 * dt; // metres the gust field moves (5.2 m/s whatever the wind's speed)
    // The wind blows towards +z here (from the north), so the field moves to +z.
    expect(gustAt(500, 300 + carried, t0 + dt, wind)).toBeCloseTo(gustAt(500, 300, t0, wind), 9);
  });

  it('change smoothly however long the game has run (no flicker late in a session)', () => {
    for (const t0 of [60, 3000, 40000]) {
      let worst = 0;
      for (let i = 0; i < 100; i++) worst = Math.max(worst, Math.abs(gustAt(120, -80, t0 + i * 0.1 + 0.1, wind) - gustAt(120, -80, t0 + i * 0.1, wind)));
      expect(worst).toBeLessThan(0.02);
    }
  });
});

describe('apparent wind', () => {
  it('is the true wind for a ship at rest', () => {
    const a = apparentWind(wind, 0.7, 0);
    expect(a.speed).toBeCloseTo(wind.speed);
    expect(a.from).toBeCloseTo(wind.from);
  });

  it('is stronger sailing into the wind and weaker running before it', () => {
    const into = apparentWind(wind, Math.PI / 2, 5); // bow to the north, into a wind from the north
    expect(into.speed).toBeCloseTo(13, 5);
    const before = apparentWind(wind, -Math.PI / 2, 5); // bow to the south, running before it
    expect(before.speed).toBeCloseTo(3, 5);
  });

  it('draws forward on a beam reach: the wind seems to come from further ahead', () => {
    const heading = 0; // east: the wind from the north is on the port beam
    const trueAngle = angleDiff(wind.from, heading);
    const felt = angleDiff(apparentWind(wind, heading, 6).from, heading);
    expect(trueAngle).toBeCloseTo(Math.PI / 2);
    expect(felt).toBeGreaterThan(0); // still on the port side
    expect(felt).toBeLessThan(trueAngle); // but ahead of the beam
  });
});

describe('heel and leeway', () => {
  const sail = (sea: typeof NO_SEA_EFFECTS, level: number, heading = 0): ReturnType<typeof createPlayerShip> => {
    const ship = createPlayerShip(OPEN.x, OPEN.z, heading);
    ship.speed = 5;
    ship.sailLevel = level;
    ship.sailTarget = level;
    stepPlayerShip(ship, brig, wind, NONE, 1, sea);
    return ship;
  };

  it('slips a ship away from the wind in the game, and not at all without it (the duel simulator)', () => {
    const slipped = sail(CALM_SEA, 1); // east, the wind from the north: it slips to the south (+z)
    expect(slipped.z - OPEN.z).toBeGreaterThan(0.05);
    expect(slipped.z - OPEN.z).toBeLessThan(1); // a few degrees, not a skid
    expect(Math.abs(sail(NO_SEA_EFFECTS, 1).z - OPEN.z)).toBeLessThan(1e-9);
  });

  it('slips downwind on either tack, more with more sail, and not with the sails down', () => {
    const port = sail(CALM_SEA, 1, 0); // heading east: the wind from the north is on the port side
    const starboard = sail(CALM_SEA, 1, Math.PI); // heading west: it is on the starboard side; both slip south, downwind
    expect(starboard.z - OPEN.z).toBeGreaterThan(0.05);
    expect(Math.abs(port.z - OPEN.z)).toBeGreaterThan(Math.abs(sail(CALM_SEA, 0.5).z - OPEN.z));
    expect(Math.abs(sail(CALM_SEA, 0).z - OPEN.z)).toBeLessThan(1e-9);
  });

  it('heels less running before the wind than on a reach (the felt wind is weaker)', () => {
    const roll = (heading: number): number => {
      const ship = createPlayerShip(OPEN.x, OPEN.z, heading);
      ship.speed = 5;
      ship.sailLevel = 1;
      ship.sailTarget = 1;
      for (let i = 0; i < 240; i++) stepPlayerShip(ship, brig, wind, NONE, 1 / 60, CALM_SEA);
      return Math.abs(ship.roll);
    };
    expect(roll(-Math.PI / 2)).toBeLessThan(roll(0));
  });
});

describe('the game in a gusty wind', () => {
  it('reports the apparent wind and the gust over each ship', () => {
    const game = createGame(brig);
    game.update(1 / 60, { rudder: 0, sailStep: 1 });
    const v = game.view();
    expect(v.ship.gust).toBeGreaterThanOrEqual(0.75);
    expect(v.ship.gust).toBeLessThanOrEqual(1.25);
    expect(v.ship.apparent.speed).toBeGreaterThan(0);
    for (const o of v.others) expect(o.apparent.speed).toBeGreaterThanOrEqual(0);
    for (const e of v.enemies) expect(Number.isFinite(e.apparent.angle)).toBe(true);
  });
});
