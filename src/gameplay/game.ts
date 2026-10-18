import type { Controls, GameView, PortView } from '../core';
import type { ShipSpec } from '../ships';
import { ISLANDS, PORTS, getPort, windAt, type Port } from '../world';
import { SAILING, createPlayerShip, maxSpeed, stepPlayerShip } from './sailing';

export interface Game {
  readonly spec: ShipSpec;
  update(dt: number, controls: Controls): void;
  view(): GameView;
}

/** Docking needs the ship this close to the anchorage and this slow. */
export const DOCK = { range: 80, maxSpeed: 2.5 } as const;
/** A port is reported as "nearest" within this distance. */
const NEAR_PORT_RANGE = 1500;
/** A port town this close is discovered; an island within its radius × 1.3 + this. */
const SEE_PORT = 500;
const SEE_ISLAND = 350;
const START_PORT = 'douwesen';
/** Start this far off the anchorage, facing open water. */
const START_OFFSET = 70;

/** Open-sea sailing sandbox: one player ship, an archipelago, ports to dock at. */
export function createGame(spec: ShipSpec): Game {
  const start = getPort(START_PORT) ?? PORTS[0];
  if (!start) throw new Error('no ports defined');
  const ox = Math.cos(start.outward);
  const oz = Math.sin(start.outward);
  // Forward is (cos ψ, -sin ψ); we want it along (ox, oz).
  const ship = createPlayerShip(start.anchor.x + ox * START_OFFSET, start.anchor.z + oz * START_OFFSET, -start.outward);

  let time = 0;
  let wind = windAt(time);
  let dockedAt: Port | null = null;
  const islands = new Set<string>();
  const ports = new Set<string>();
  let islandList: string[] = [];
  let portList: string[] = [];

  const nearest = (): { port: Port; distance: number } | null => {
    let best: { port: Port; distance: number } | null = null;
    for (const port of PORTS) {
      const distance = Math.hypot(port.anchor.x - ship.x, port.anchor.z - ship.z);
      if (!best || distance < best.distance) best = { port, distance };
    }
    return best && best.distance <= NEAR_PORT_RANGE ? best : null;
  };

  const canDock = (distance: number): boolean => distance <= DOCK.range && Math.abs(ship.speed) <= DOCK.maxSpeed;

  const discover = (): void => {
    let changed = false;
    for (const i of ISLANDS) {
      if (!islands.has(i.id) && Math.hypot(i.x - ship.x, i.z - ship.z) < i.radius * 1.3 + SEE_ISLAND) {
        islands.add(i.id);
        changed = true;
      }
    }
    if (changed) islandList = [...islands];
    changed = false;
    for (const p of PORTS) {
      if (!ports.has(p.id) && Math.hypot(p.town.x - ship.x, p.town.z - ship.z) < SEE_PORT) {
        ports.add(p.id);
        changed = true;
      }
    }
    if (changed) portList = [...ports];
  };
  discover();

  const toggleDock = (): void => {
    if (dockedAt) {
      dockedAt = null;
      ship.docked = false;
      return;
    }
    const n = nearest();
    if (n && canDock(n.distance)) {
      dockedAt = n.port;
      ship.docked = true;
      ship.speed = 0;
    }
  };

  return {
    spec,
    update(dt, controls): void {
      time += dt;
      wind = windAt(time);
      if (controls.interact) toggleDock();
      stepPlayerShip(ship, spec, wind, controls, dt);
      discover();
    },
    view(): GameView {
      const n = nearest();
      const nearestPort: PortView | null = n && {
        id: n.port.id,
        name: n.port.name,
        distance: n.distance,
        direction: Math.atan2(-(n.port.anchor.z - ship.z), n.port.anchor.x - ship.x),
        dockable: !dockedAt && canDock(n.distance),
      };
      return {
        time,
        wind,
        ship: {
          x: ship.x,
          z: ship.z,
          heading: ship.heading,
          speed: ship.speed,
          knots: ship.speed / SAILING.speedScale,
          maxKnots: maxSpeed(spec) / SAILING.speedScale,
          rudder: ship.rudder,
          sailLevel: ship.sailLevel,
          sailTarget: ship.sailTarget,
          efficiency: ship.efficiency,
          roll: ship.roll,
        },
        nearestPort,
        docked: dockedAt?.id ?? null,
        grounded: ship.grounded > 0,
        discoveredIslands: islandList,
        discoveredPorts: portList,
      };
    },
  };
}
