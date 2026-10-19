import { describe, expect, it } from 'vitest';
import { createGame } from '../src/gameplay';
import { SHIP_SPECS, getShipSpec } from '../src/ships';
import { FOAM, MAX_STAMPS, collectStamps, impactStamp, shipStamps, type ShipMotion, type Stamp } from '../src/render/wakeStamps';

const ship = (over: Partial<ShipMotion> = {}): ShipMotion => ({ x: 100, z: 50, heading: 0, speed: 6, length: 20, beam: 6, sinking: -1, ...over });
const stampsOf = (m: ShipMotion, dt = 1 / 60, sea = 0): Stamp[] => {
  const out: Stamp[] = [];
  shipStamps(m, dt, sea, out);
  return out;
};

describe('shipStamps', () => {
  it('lays a waterline ring, a bow wave, a stern wash, shoulders and diverging arms behind a moving ship', () => {
    const s = stampsOf(ship());
    expect(s.filter((x) => x.kind === 1)).toHaveLength(1);
    expect(s.length).toBe(1 + 1 + 1 + 2 + 2 * FOAM.armStart.length);
    const bow = s.find((x) => x.kind === 0 && x.height > 0 && x.x > 100);
    const wash = s.find((x) => x.height < 0);
    expect(bow && bow.x > 100).toBe(true); // heading 0: the bow is to +x
    expect(wash && wash.x < 100).toBe(true);
    // the shoulders and the arms sit either side of the wake, the arms ever wider the further back they start
    const sides = s.filter((x) => x.kind === 0 && x.height >= 0 && x.x < 100);
    expect(sides.length).toBe(2 + 2 * FOAM.armStart.length);
    const arms = sides.filter((x) => x.height > 0).sort((a, b) => b.x - a.x);
    const starboard = arms.filter((x) => x.z > 50);
    const port = arms.filter((x) => x.z < 50);
    expect(starboard).toHaveLength(FOAM.armStart.length);
    expect(port).toHaveLength(FOAM.armStart.length);
    expect(starboard[0]!.z - 50).toBeLessThan(starboard[1]!.z - 50);
  });

  it('lays the wash along the way the ship really goes, not where its bow points', () => {
    const slip = stampsOf(ship({ heading: 0, course: -0.3 }));
    const wash = slip.find((x) => x.height < 0)!;
    expect(wash.heading).toBeCloseTo(-0.3);
    expect(slip.find((x) => x.kind === 1)!.heading).toBe(0); // the hull's own ring stays with the hull
    expect(stampsOf(ship()).find((x) => x.height < 0)!.heading).toBe(0); // no course: the bow's
  });

  it('leaves about the same foam where a ship has passed, whatever its size (a big ship is not a white-out)', () => {
    // the foam a point of water gets from the wash while the ship passes over it: rate × time under the stamp
    const passed = (id: string): number => {
      const sp = getShipSpec(id)!;
      const m = ship({ length: sp.length, beam: sp.beam, speed: 7 });
      const wash = stampsOf(m, 1 / 60).find((x) => x.height < 0)!;
      return wash.foam * 60 * ((0.675 * wash.length) / 7);
    };
    const small = passed('tartane');
    for (const sp of SHIP_SPECS) {
      const f = passed(sp.id);
      expect(f).toBeGreaterThan(small * 0.9);
      expect(f).toBeLessThan(small * 1.8);
      expect(f).toBeLessThan(2); // a soft ceiling: the sea shader saturates smoothly from here
    }
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
