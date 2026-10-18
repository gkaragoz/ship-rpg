import type { Deck, ShipSpec } from '../ships';
import { CREW } from './crewData';

/** Where the work is on a ship's deck (ship-local x, z): the masts, the helm and the gun stations of each side. */
export interface CrewLayout {
  masts: { x: number; height: number }[];
  /** Where the helmsman stands, or null when no free spot was found. */
  helm: { x: number; z: number } | null;
  /** Free spots along each rail, bow to stern. */
  guns: { port: { x: number; z: number }[]; starboard: { x: number; z: number }[] };
}

/** Most gun stations kept per side (the work is shown, not every gun: a crew of ten cannot serve forty). */
const MAX_STATIONS = 6;

/** Layout of the visible work on `spec`'s deck: masts from the spec, the helm aft, gun stations spread along the rails. */
export function crewLayout(spec: ShipSpec, deck: Deck): CrewLayout {
  const r = CREW.bodyRadius;
  const masts = spec.masts.map((m) => ({ x: (0.5 - m.at) * spec.length, height: m.height }));

  let helm: CrewLayout['helm'] = null;
  for (let x = deck.minX + 1; x < deck.minX + (deck.maxX - deck.minX) * 0.45 && !helm; x += 0.25) {
    for (const z of [0, 0.5, -0.5, 1, -1]) {
      if (!helm && deck.walkable(x, z, r + 0.1)) helm = { x, z };
    }
  }

  const stations = (sign: 1 | -1): { x: number; z: number }[] => {
    const out: { x: number; z: number }[] = [];
    const n = Math.min(MAX_STATIONS, Math.max(2, Math.round(spec.stats.cannons / 2)));
    const from = deck.minX + (deck.maxX - deck.minX) * 0.22;
    const to = deck.maxX - (deck.maxX - deck.minX) * 0.22;
    for (let i = 0; i < n; i++) {
      const x0 = from + ((to - from) * (i + 0.5)) / n;
      // the nearest free spot to the rail within a metre or two along the deck
      for (let dx = 0; dx <= 1.5 && out.length <= i; dx += 0.25) {
        for (const x of [x0 + dx, x0 - dx]) {
          const z = sign * (deck.halfWidthAt(x) - 0.5);
          if (deck.walkable(x, z, r + 0.05)) {
            out.push({ x, z });
            break;
          }
        }
      }
    }
    return out;
  };
  return { masts, helm, guns: { port: stations(-1), starboard: stations(1) } };
}
