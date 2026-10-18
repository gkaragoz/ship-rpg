import { describe, expect, it } from 'vitest';
import { createGame } from '../src/gameplay';
import { getShipSpec } from '../src/ships';
import { PORTS, PORT_ZONE, insidePortZone, portZoneCentre, portZoneCorners, portZoneLocal, terrainHeight } from '../src/world';

const brig = getShipSpec('brig');
if (!brig) throw new Error('brig spec missing');
const DT = 1 / 60;

describe('port entry zones', () => {
  it('covers the anchorage and the start position, with its corners on the rectangle', () => {
    for (const port of PORTS) {
      expect(insidePortZone(port, port.anchor.x, port.anchor.z)).toBe(true);
      const c = portZoneCentre(port);
      expect(insidePortZone(port, c.x, c.z)).toBe(true);
      const corners = portZoneCorners(port);
      expect(corners).toHaveLength(4);
      for (const c of corners) {
        const { along, across } = portZoneLocal(port, c.x, c.z);
        expect(Math.abs(along)).toBeCloseTo(PORT_ZONE.halfLength, 6);
        expect(Math.abs(across)).toBeCloseTo(PORT_ZONE.halfWidth, 6);
      }
    }
  });

  it('is a rectangle turned to face the sea: long side along the port bearing', () => {
    const port = PORTS[0]!;
    const c = Math.cos(port.outward);
    const s = Math.sin(port.outward);
    const o = portZoneCentre(port);
    const at = (along: number, across: number): boolean => insidePortZone(port, o.x + c * along - s * across, o.z + s * along + c * across);
    expect(at(PORT_ZONE.halfLength - 1, 0)).toBe(true);
    expect(at(PORT_ZONE.halfLength + 1, 0)).toBe(false);
    expect(at(0, PORT_ZONE.halfWidth - 1)).toBe(true);
    expect(at(0, PORT_ZONE.halfWidth + 1)).toBe(false);
    expect(at(-PORT_ZONE.halfLength + 1, -PORT_ZONE.halfWidth + 1)).toBe(true);
  });

  it('keeps the centre of every zone in deep water, so ships can reach it', () => {
    for (const port of PORTS) expect(terrainHeight(port.anchor.x, port.anchor.z)).toBeLessThan(-9);
  });

  it('starts the game inside the start port zone and reports it', () => {
    const v = createGame(brig!).view();
    expect(v.nearestPort?.inZone).toBe(true);
    expect(v.nearestPort?.dockable).toBe(true);
  });

  it('only lets the ship enter from inside the zone, not merely from near it', () => {
    const game = createGame(brig!);
    const start = game.view();
    const port = PORTS.find((p) => p.id === start.nearestPort?.id)!;
    // sail straight out to sea until clear of the zone but still near the anchorage
    game.update(DT, { rudder: 0, sailStep: 1 });
    let guard = 0;
    while (insidePortZone(port, game.view().ship.x, game.view().ship.z) && guard++ < 60 * 90) game.update(DT, { rudder: 0, sailStep: 0 });
    const out = game.view();
    expect(insidePortZone(port, out.ship.x, out.ship.z)).toBe(false);
    expect(out.nearestPort?.inZone).toBe(false);
    expect(out.nearestPort?.dockable).toBe(false);
    game.update(DT, { rudder: 0, sailStep: 0, interact: true });
    expect(game.view().docked).toBeNull();
  });
});
