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
