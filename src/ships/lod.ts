/** Level of detail of a ship model: 0 = full quality, 1 = reduced, 2 = distant silhouette. */
export type ShipLod = 0 | 1 | 2;

/**
 * Distances (in ship lengths) where a ship drops to the next level: LOD0 below the first,
 * LOD1 below the second, LOD2 beyond. Scaling by length keeps the screen size of the switch
 * roughly equal for a 12 m tartane and a 60 m battleship.
 */
export const LOD_RANGES: readonly [number, number] = [5, 18];

/** A level only changes once the ship is this far (fraction) past the threshold, so it never flickers. */
export const LOD_HYSTERESIS = 0.12;

const threshold = (level: 0 | 1, length: number): number => LOD_RANGES[level] * length;

/**
 * Pick the LOD for a ship `distance` metres from the camera. Pass the previous level to apply
 * hysteresis; pass `null` (first frame) to take the plain threshold result.
 */
export function selectLod(distance: number, length: number, previous: ShipLod | null): ShipLod {
  let lod: ShipLod = previous ?? (distance < threshold(0, length) ? 0 : distance < threshold(1, length) ? 1 : 2);
  if (previous === null) return lod;
  for (;;) {
    if (lod < 2 && distance > threshold(lod as 0 | 1, length) * (1 + LOD_HYSTERESIS)) lod = (lod + 1) as ShipLod;
    else if (lod > 0 && distance < threshold((lod - 1) as 0 | 1, length) * (1 - LOD_HYSTERESIS)) lod = (lod - 1) as ShipLod;
    else return lod;
  }
}

/**
 * Staggered refresh: with `every` = 6, ship `index` re-evaluates its LOD on frames where
 * (frame + index) % 6 == 0, so a whole fleet never updates on the same frame.
 */
export function lodUpdateDue(frame: number, index: number, every = 6): boolean {
  return (frame + index) % every === 0;
}
