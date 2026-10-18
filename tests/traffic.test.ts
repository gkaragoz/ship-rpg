import { describe, expect, it } from 'vitest';
import { createNpcFleet } from '../src/gameplay/npcShips';
import { TRAFFIC, TRAFFIC_LINES, berthOf, createTraffic, lineClear, routeBetween, trafficPortsKnown } from '../src/gameplay/traffic';
import { PORTS, getPort, insidePortZone, terrainHeight } from '../src/world';
import { getShipSpec } from '../src/ships';

const wind = { from: Math.PI / 2, speed: 8 };

describe('sea lanes', () => {
  it('lead from anchorage to anchorage through open water, between every pair of ports', () => {
    for (const a of PORTS) {
      for (const b of PORTS) {
        if (a === b) continue;
        const route = routeBetween(a, b);
        expect(route[0]).toEqual(berthOf(a));
        expect(route[route.length - 1]).toEqual(berthOf(b));
        for (let i = 1; i < route.length; i++) expect(lineClear(route[i - 1]!, route[i]!), `${a.id} -> ${b.id} leg ${i}`).toBe(true);
        expect(route.length).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe('merchant traffic', () => {
  it('has lines that call at real ports with real ships', () => {
    expect(trafficPortsKnown()).toBe(true);
    for (const l of TRAFFIC_LINES) expect(getShipSpec(l.specId), l.specId).toBeDefined();
  });

  it('is a function of time: the same everywhere, nothing to save', () => {
    const a = createTraffic().views(1234, wind, 12);
    const b = createTraffic().views(1234, wind, 12);
    expect(a).toEqual(b);
    expect(a.map((v) => v.id)).toEqual([12, 13, 14, 15, 16, 17]);
    expect(a.map((v) => v.specId)).toEqual(TRAFFIC_LINES.map((l) => l.specId));
    for (const v of a) expect(['english', 'french', 'spanish', 'dutch', 'free']).toContain(v.nation);
  });

  it('sails smoothly, never faster than its pace, on open water, and lies at the quays in between', () => {
    const traffic = createTraffic();
    let last = traffic.views(0, wind, 0);
    let lay = 0;
    let sailed = 0;
    for (let t = 1; t <= 6000; t++) {
      const now = traffic.views(t, wind, 0);
      now.forEach((v, i) => {
        const d = Math.hypot(v.x - last[i]!.x, v.z - last[i]!.z);
        expect(d, `ship ${i} at ${t}`).toBeLessThan(TRAFFIC.speed * 1.5);
        if (v.sailLevel > 0) {
          sailed++;
          expect(terrainHeight(v.x, v.z), `ship ${i} at ${t} is on land`).toBeLessThan(TRAFFIC.clearDepth + 4);
        } else lay++;
      });
      last = now;
    }
    expect(sailed).toBeGreaterThan(lay);
    expect(lay).toBeGreaterThan(0);
  });

  it('lies at a berth in open water beside the anchorage, outside the entry zone, in every port', () => {
    for (const p of PORTS) {
      const b = berthOf(p);
      expect(terrainHeight(b.x, b.z), p.id).toBeLessThan(TRAFFIC.clearDepth);
      expect(insidePortZone(p, b.x, b.z), p.id).toBe(false);
    }
  });

  it('lies off the anchorage of the port it calls at, clear of the entry zone', () => {
    const line = TRAFFIC_LINES[0]!;
    const port = getPort(line.calls[1]!)!;
    const traffic = createTraffic();
    let atQuay = false;
    for (let t = 0; t < 20000 && !atQuay; t += 5) {
      const v = traffic.views(t, wind, 0)[0]!;
      if (v.sailLevel === 0 && Math.hypot(v.x - port.anchor.x, v.z - port.anchor.z) < TRAFFIC.berth + 5) atQuay = true;
      if (v.sailLevel === 0) expect(insidePortZone(port, v.x, v.z) && Math.hypot(v.x - port.anchor.x, v.z - port.anchor.z) < 1).toBe(false);
    }
    expect(atQuay).toBe(true);
  });

  it('joins the patrols in the fleet, numbered after them, so the game sees one list', () => {
    const fleet = createNpcFleet({ x: 0, z: 0 });
    const v = fleet.view();
    expect(v).toHaveLength(18);
    expect(v.map((o) => o.id)).toEqual([...v.keys()]);
  });
});
