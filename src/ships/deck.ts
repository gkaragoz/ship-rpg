/**
 * Walkable deck of a GLB ship, built from the `<id>.meta.json` the Blender generator writes
 * next to the model (docs/SHIP_ASSETS.md). Ship-local space: +x bow, +y up, +z starboard.
 */
export type DeckObstacle =
  | { type: 'circle'; x: number; z: number; r: number }
  | { type: 'rect'; x0: number; x1: number; z0: number; z1: number };

export interface ShipModelMeta {
  id: string;
  length: number;
  beam: number;
  lods: Record<string, { tris: number; meshes: number; drawCalls: number }>;
  /** Sail pivot position (x, y, z) in ship-local space. */
  trimPivot: [number, number, number];
  deck: { columns: ['x', 'y', 'halfWidth']; stations: [number, number, number][] };
  obstacles: DeckObstacle[];
  lantern: [number, number, number];
}

export interface Deck {
  readonly minX: number;
  readonly maxX: number;
  /** Deck surface height at `x` (clamped to the ends). */
  heightAt(x: number): number;
  /** Walkable half width at `x` (already inset from the rail; 0 where the bow is too narrow). */
  halfWidthAt(x: number): number;
  /** Is a body of `radius` standing at (x, z) on the deck and clear of every obstacle? */
  walkable(x: number, z: number, radius: number): boolean;
}

export function createDeck(meta: ShipModelMeta): Deck {
  const st = meta.deck.stations;
  const first = st[0];
  const last = st[st.length - 1];
  if (!first || !last) throw new Error(`deck profile of ${meta.id} is empty`);

  const sample = (x: number, col: 1 | 2): number => {
    if (x <= first[0]) return first[col];
    if (x >= last[0]) return last[col];
    for (let i = 1; i < st.length; i++) {
      const b = st[i];
      const a = st[i - 1];
      if (b && a && x <= b[0]) {
        const t = (x - a[0]) / (b[0] - a[0]);
        return a[col] + (b[col] - a[col]) * t;
      }
    }
    return last[col];
  };

  const blocked = (o: DeckObstacle, x: number, z: number, r: number): boolean =>
    o.type === 'circle'
      ? Math.hypot(x - o.x, z - o.z) < o.r + r
      : x > o.x0 - r && x < o.x1 + r && z > o.z0 - r && z < o.z1 + r;

  return {
    minX: first[0],
    maxX: last[0],
    heightAt: (x) => sample(x, 1),
    halfWidthAt: (x) => sample(x, 2),
    walkable(x, z, radius): boolean {
      if (x < first[0] + radius || x > last[0] - radius) return false;
      if (Math.abs(z) > sample(x, 2) - radius) return false;
      return !meta.obstacles.some((o) => blocked(o, x, z, radius));
    },
  };
}
