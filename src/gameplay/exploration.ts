import { ISLANDS, PORTS, type Port } from '../world';

/** A port town this close is discovered; an island within its radius × 1.3 + this. */
const SEE_PORT = 500;
const SEE_ISLAND = 350;
/** A port is reported as "nearest" within this distance. */
const NEAR_PORT_RANGE = 1500;

export interface Exploration {
  /** Closest port anchorage within range, or null. */
  nearest(): { port: Port; distance: number } | null;
  /** Mark islands and ports now in sight as discovered. */
  discover(): void;
  islands(): readonly string[];
  ports(): readonly string[];
}

/** Fog of war and nearest-port lookup for whatever position `at()` returns. */
export function createExploration(at: () => { x: number; z: number }): Exploration {
  const islands = new Set<string>();
  const ports = new Set<string>();
  let islandList: string[] = [];
  let portList: string[] = [];

  return {
    nearest(): { port: Port; distance: number } | null {
      const p = at();
      let best: { port: Port; distance: number } | null = null;
      for (const port of PORTS) {
        const distance = Math.hypot(port.anchor.x - p.x, port.anchor.z - p.z);
        if (!best || distance < best.distance) best = { port, distance };
      }
      return best && best.distance <= NEAR_PORT_RANGE ? best : null;
    },
    discover(): void {
      const p = at();
      let changed = false;
      for (const i of ISLANDS) {
        if (!islands.has(i.id) && Math.hypot(i.x - p.x, i.z - p.z) < i.radius * 1.3 + SEE_ISLAND) {
          islands.add(i.id);
          changed = true;
        }
      }
      if (changed) islandList = [...islands];
      changed = false;
      for (const port of PORTS) {
        if (!ports.has(port.id) && Math.hypot(port.town.x - p.x, port.town.z - p.z) < SEE_PORT) {
          ports.add(port.id);
          changed = true;
        }
      }
      if (changed) portList = [...ports];
    },
    islands: () => islandList,
    ports: () => portList,
  };
}
