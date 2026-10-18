import { describe, expect, it } from 'vitest';
import { NO_SEA_EFFECTS, createBody, gunScatter, periods, seaEffects, stepBody } from '../src/gameplay/buoyancy';
import { createGame } from '../src/gameplay';
import { getShipSpec } from '../src/ships';

const spec = (id: string) => {
  const s = getShipSpec(id);
  if (!s) throw new Error(`no ${id}`);
  return s;
};

/** Run a hull at rest in the sea for `seconds` and report how far it swings. */
function swing(id: string, sea: number, seconds = 90): { heave: number; pitch: number; roll: number } {
  const s = spec(id);
  const body = createBody();
  const ship = { x: 0, z: 0, heading: 0 };
  let heave = 0;
  let pitch = 0;
  let roll = 0;
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    stepBody(body, ship, s, t, 1.2, sea, dt);
    if (t > 20) {
      heave = Math.max(heave, Math.abs(body.heave));
      pitch = Math.max(pitch, Math.abs(body.pitch));
      roll = Math.max(roll, Math.abs(body.waveRoll));
    }
  }
  return { heave, pitch, roll };
}

describe('stepBody', () => {
  it('stays almost still on a glassy sea and heaves, pitches and rolls on a storm sea', () => {
    const calm = swing('tartane', 0);
    const storm = swing('tartane', 1);
    expect(calm.heave).toBeLessThan(0.4);
    expect(storm.heave).toBeGreaterThan(calm.heave * 3);
    expect(storm.pitch).toBeGreaterThan(calm.pitch * 2);
    expect(storm.roll).toBeGreaterThan(0.03);
    expect(storm.roll).toBeLessThanOrEqual(0.6);
  });

  it('is deterministic', () => {
    expect(swing('brig', 0.7)).toEqual(swing('brig', 0.7));
  });

  it('lets a big ship ride calmer than a small one in the same sea', () => {
    const small = swing('tartane', 1);
    const big = swing('battleship', 1);
    expect(big.heave).toBeLessThan(small.heave);
    expect(big.pitch).toBeLessThan(small.pitch * 1.1);
    expect(periods(64).heave).toBeGreaterThan(periods(12).heave);
  });

  it('shelters a moored hull', () => {
    const s = spec('tartane');
    const open = createBody();
    const moored = createBody();
    let a = 0;
    let b = 0;
    for (let t = 0; t < 60; t += 1 / 60) {
      stepBody(open, { x: 0, z: 0, heading: 0 }, s, t, 1.2, 1, 1 / 60, false);
      stepBody(moored, { x: 0, z: 0, heading: 0 }, s, t, 1.2, 1, 1 / 60, true);
      a = Math.max(a, Math.abs(open.heave));
      b = Math.max(b, Math.abs(moored.heave));
    }
    expect(b).toBeLessThan(a * 0.6);
  });
});

describe('seaEffects', () => {
  const tartane = spec('tartane');
  const battleship = spec('battleship');

  it('changes nothing in fair weather', () => {
    // no change to speed, turning or flooding (the ship still slips to leeward: `lee`, which the duel simulator leaves out)
    expect(seaEffects(tartane, 0.3, 1.2, 0)).toEqual({ ...NO_SEA_EFFECTS, lee: 1 });
    expect(seaEffects(tartane, 0.3, 1.2, 0.3)).toEqual({ ...NO_SEA_EFFECTS, lee: 1 });
    expect(gunScatter({ heave: 0, pitch: 0.2, waveRoll: 0.2 }, 0.2)).toBe(1);
  });

  it('slows a ship that meets a storm head on more than one running before it', () => {
    const windFrom = 1.2;
    const head = seaEffects(tartane, windFrom, windFrom, 1);
    const beam = seaEffects(tartane, windFrom + Math.PI / 2, windFrom, 1);
    const before = seaEffects(tartane, windFrom + Math.PI, windFrom, 1);
    expect(head.speed).toBeLessThan(0.85);
    expect(head.speed).toBeLessThan(beam.speed);
    expect(beam.speed).toBeCloseTo(1, 5);
    expect(before.speed).toBeCloseTo(1, 5);
    expect(head.turn).toBeLessThan(1);
  });

  it('hurts small ships more, and floods only low ships in a heavy sea', () => {
    expect(seaEffects(tartane, 0, 0, 1).speed).toBeLessThan(seaEffects(battleship, 0, 0, 1).speed);
    expect(seaEffects(tartane, 0, 0, 1).shipping).toBeGreaterThan(0);
    expect(seaEffects(battleship, 0, 0, 1).shipping).toBe(0);
    expect(seaEffects(tartane, 0, 0, 0.35).shipping).toBe(0);
  });

  it('widens the guns of a rolling hull in a storm', () => {
    const body = { heave: 0, pitch: 0.1, waveRoll: 0.2 };
    expect(gunScatter(body, 1)).toBeGreaterThan(1.5);
    expect(gunScatter(body, 0.6)).toBeLessThan(gunScatter(body, 1));
  });
});

describe('game in a rough sea', () => {
  it('carries the attitude in the view, floods a low ship in a storm and not in fair weather', () => {
    const run = (sea: number): { flooding: number; moved: number } => {
      const g = createGame(spec('tartane'));
      g.dev.setSea(sea);
      g.dev.teleportPlayer(-3500, 3500); // clear of the patrols that sail around the start
      let moved = 0;
      for (let i = 0; i < 60 * 60; i++) {
        g.update(1 / 60, { rudder: 0, sailStep: i === 0 ? 1 : 0 });
        if (i % 60 === 0) moved = Math.max(moved, Math.abs(g.view().ship.heave));
      }
      return { flooding: g.view().ship.flooding, moved };
    };
    const fair = run(0.2);
    const storm = run(1);
    expect(fair.flooding).toBe(0);
    expect(storm.flooding).toBeGreaterThan(0.02); // green water outpaces the pumps on a low ship
    expect(storm.moved).toBeGreaterThan(fair.moved);
    expect(createGame(spec('tartane')).view().ship).toMatchObject({ heave: 0, pitch: 0, waveRoll: 0 });
  });
});
