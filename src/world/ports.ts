import { ISLANDS, terrainHeight, type Island } from './islands';

export interface Port {
  id: string;
  name: string;
  islandId: string;
  description: string;
  /** Centre of the town on land. */
  town: { x: number; z: number };
  /** Where the shoreline meets the sea along the port's bearing. */
  coast: { x: number; z: number };
  /** Safe deep-water spot in front of the town where ships dock. */
  anchor: { x: number; z: number };
  /** Direction from land out to sea, radians in the (x, z) plane. */
  outward: number;
}

/**
 * The marked rectangle in front of every port: a ship inside it (and slow) may enter. It lies across the anchorage and
 * reaches further out to sea than towards the shore (its centre is `centre` m seaward of the anchorage).
 */
export const PORT_ZONE = { centre: 35, halfLength: 55, halfWidth: 45 } as const;

/** Centre of the port's entry zone in world (x, z). */
export function portZoneCentre(port: Port): { x: number; z: number } {
  return { x: port.anchor.x + Math.cos(port.outward) * PORT_ZONE.centre, z: port.anchor.z + Math.sin(port.outward) * PORT_ZONE.centre };
}

/** Position of `(x, z)` in the port zone's own axes: `along` out to sea from the zone's centre, `across` the coast line. */
export function portZoneLocal(port: Port, x: number, z: number): { along: number; across: number } {
  const o = portZoneCentre(port);
  const dx = x - o.x;
  const dz = z - o.z;
  const c = Math.cos(port.outward);
  const s = Math.sin(port.outward);
  return { along: dx * c + dz * s, across: -dx * s + dz * c };
}

/** The four corners of the port zone in world (x, z), going round. */
export function portZoneCorners(port: Port): { x: number; z: number }[] {
  const o = portZoneCentre(port);
  const c = Math.cos(port.outward);
  const s = Math.sin(port.outward);
  return ([[1, 1], [1, -1], [-1, -1], [-1, 1]] as const).map(([a, b]) => ({
    x: o.x + c * a * PORT_ZONE.halfLength - s * b * PORT_ZONE.halfWidth,
    z: o.z + s * a * PORT_ZONE.halfLength + c * b * PORT_ZONE.halfWidth,
  }));
}

/** Is `(x, z)` inside the port's entry zone? */
export function insidePortZone(port: Port, x: number, z: number): boolean {
  const { along, across } = portZoneLocal(port, x, z);
  return Math.abs(along) <= PORT_ZONE.halfLength && Math.abs(across) <= PORT_ZONE.halfWidth;
}

const COAST_HEIGHT = 0.3;
const TOWN_INLAND = 30;
/** Anchorage must be at least this deep (m) in a small patch, so every keel clears it. */
const ANCHOR_DEPTH = 9;
const ANCHOR_MIN_OFFSHORE = 70;

/** Walk from the island centre along `angle` until the land drops to the waterline. */
function findCoast(island: Island, angle: number): number {
  const cx = Math.cos(angle);
  const cz = Math.sin(angle);
  for (let r = 0; r < island.radius * 2.2; r += 2) {
    if (terrainHeight(island.x + cx * r, island.z + cz * r) < COAST_HEIGHT) return r;
  }
  return island.radius;
}

/** First distance beyond the coast where a 12 m patch is deep enough to anchor; throws if there is none. */
function findAnchor(portId: string, x: number, z: number, cx: number, cz: number): number {
  const deep = (d: number): boolean =>
    [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]].every(
      ([ox, oz]) => terrainHeight(x + cx * d + (ox ?? 0), z + cz * d + (oz ?? 0)) < -ANCHOR_DEPTH,
    );
  for (let d = ANCHOR_MIN_OFFSHORE; d < 500; d += 5) if (deep(d)) return d;
  throw new Error(`port ${portId}: no ${ANCHOR_DEPTH} m deep anchorage within 500 m of the coast`);
}

export const PORTS: readonly Port[] = ISLANDS.flatMap((island) =>
  island.ports.map((def): Port => {
    const cx = Math.cos(def.angle);
    const cz = Math.sin(def.angle);
    const r = findCoast(island, def.angle);
    const at = (d: number): { x: number; z: number } => ({ x: island.x + cx * (r + d), z: island.z + cz * (r + d) });
    return {
      id: def.id,
      name: def.name,
      islandId: island.id,
      description: def.description,
      town: at(-TOWN_INLAND),
      coast: at(0),
      anchor: at(findAnchor(def.id, island.x + cx * r, island.z + cz * r, cx, cz)),
      outward: def.angle,
    };
  }),
);

export const getPort = (id: string): Port | undefined => PORTS.find((p) => p.id === id);
