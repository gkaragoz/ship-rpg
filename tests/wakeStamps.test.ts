import { describe, expect, it } from 'vitest';
import { createGame } from '../src/gameplay';
import { getShipSpec } from '../src/ships';
import { MAX_STAMPS, collectStamps, impactStamp, shipStamps, type ShipMotion, type Stamp } from '../src/render/wakeStamps';

const ship = (over: Partial<ShipMotion> = {}): ShipMotion => ({ x: 100, z: 50, heading: 0, speed: 6, length: 20, beam: 6, sinking: -1, ...over });
const stampsOf = (m: ShipMotion, dt = 1 / 60, sea = 0): Stamp[] => {
  const out: Stamp[] = [];
  shipStamps(m, dt, sea, out);
  return out;
};

describe('shipStamps', () => {
  it('lays a waterline ring, a bow wave, a stern wash and two arms behind a moving ship', () => {
    const s = stampsOf(ship());
    expect(s.filter((x) => x.kind === 1)).toHaveLength(1);
    expect(s.length).toBe(5);
    const bow = s.find((x) => x.height > 0);
    const wash = s.find((x) => x.height < 0);
    expect(bow && bow.x > 100).toBe(true); // heading 0: the bow is to +x
    expect(wash && wash.x < 100).toBe(true);
    // the arms sit either side of the wake
    const arms = s.filter((x) => x.kind === 0 && x.height === 0);
    expect(arms).toHaveLength(2);
    expect(Math.sign(arms[0]!.z - 50)).toBe(-Math.sign(arms[1]!.z - 50));
  });

  it('puts the bow ahead of the ship whichever way it points', () => {
    const north = stampsOf(ship({ heading: Math.PI / 2 })).find((x) => x.height > 0)!;
    expect(north.z).toBeLessThan(50); // heading ψ = π/2 points to -z
    expect(Math.abs(north.x - 100)).toBeLessThan(1e-9);
  });

  it('paints more for a faster ship and a rougher sea, and per frame so it is frame-rate independent', () => {
    const total = (m: ShipMotion, dt: number, sea: number): number => stampsOf(m, dt, sea).reduce((a, x) => a + x.foam, 0);
    expect(total(ship({ speed: 8 }), 1 / 60, 0)).toBeGreaterThan(total(ship({ speed: 2 }), 1 / 60, 0));
    expect(total(ship(), 1 / 60, 1)).toBeGreaterThan(total(ship(), 1 / 60, 0));
    expect(total(ship(), 1 / 30, 0)).toBeCloseTo(total(ship(), 1 / 60, 0) * 2, 6);
  });

  it('leaves only the faint hull ring on a ship at rest, and churns the water of a sinking one', () => {
    const rest = stampsOf(ship({ speed: 0 }));
    expect(rest).toHaveLength(1);
    expect(rest[0]!.kind).toBe(1);
    const sinking = stampsOf(ship({ speed: 0, sinking: 3 }));
    expect(sinking).toHaveLength(1);
    expect(sinking[0]!.foam).toBeGreaterThan(rest[0]!.foam);
    expect(sinking[0]!.width).toBeGreaterThan(ship().beam);
  });

  it('puts the wash astern when a ship moves backwards', () => {
    const back = stampsOf(ship({ speed: -3 }));
    expect(back.find((x) => x.height > 0)!.x).toBeLessThan(100);
  });
});

describe('collectStamps', () => {
  const spec = getShipSpec('tartane');
  if (!spec) throw new Error('no tartane');
  const dims = { length: spec.length, beam: spec.beam };

  it('collects the player, the patrol ships and the splashes inside the map, and skips what lies outside', () => {
    const game = createGame(spec);
    for (let i = 0; i < 120; i++) game.update(1 / 60, { rudder: 0, sailStep: i === 0 ? 1 : 0 });
    const view = game.view();
    const out: Stamp[] = [];
    // a map centred on the player, 360 m across: the player at least, never more than the cap
    collectStamps(view, 1 / 60, dims, () => dims, view.ship.x, view.ship.z, 180, out);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(MAX_STAMPS);
    // far away from everything: nothing
    collectStamps(view, 1 / 60, dims, () => dims, 1e6, 1e6, 180, out);
    expect(out).toHaveLength(0);
    // a splash makes an impact stamp
    collectStamps({ ...view, events: [{ type: 'splash', owner: 'player', x: view.ship.x + 5, y: 0, z: view.ship.z }] }, 1 / 60, null, () => null, view.ship.x, view.ship.z, 180, out);
    expect(out.some((s) => s.length === 5.2 && s.foam > 1)).toBe(true);
  });

  it('keeps the player out of the wake map when moored', () => {
    const game = createGame(spec);
    const view = { ...game.view(), docked: 'douwesen' };
    const out: Stamp[] = [];
    collectStamps({ ...view, others: [], enemies: [] }, 1 / 60, dims, () => null, view.ship.x, view.ship.z, 180, out);
    expect(out).toHaveLength(0);
  });

  it('makes impacts of the requested size', () => {
    const s = impactStamp(1, 2, 3, 0.5);
    expect(s).toMatchObject({ x: 1, z: 2, length: 6, width: 6, foam: 0.5, height: 0, kind: 0 });
  });
});
