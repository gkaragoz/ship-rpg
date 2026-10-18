import type { ShipSpec } from '../ships';
import { GOODS } from '../world';
import { COMPANY } from './company';

/** When a crippled enemy can be boarded and how the fight is decided. */
export const BOARDING = {
  /** The enemy must be at or below this share of its hull (or fleeing). */
  maxHullShare: 0.4,
  /** Centre distance allowed beyond a quarter of the two lengths (m): the hulls are alongside. */
  reach: 20,
  /** Closing speed allowed (m/s): match a runner's course and speed to catch it. */
  maxRelSpeed: 4,
  /** Seconds before another try after a failed boarding. */
  cooldown: 15,
  /** An enemy's crew, as a share of its listed crew (before damage thins it). */
  enemyCrew: 0.8,
  /** Gold looted: this share of the enemy's price (× 1000) × 0.5 … 1.5, × the captain's loot bonus. */
  lootShare: 0.08,
} as const;

/** The enemy's fighting crew: thinned by the battering it took. */
export const enemyCrewOf = (spec: ShipSpec, hpShare: number): number =>
  Math.round(spec.stats.crew * BOARDING.enemyCrew * (0.4 + 0.6 * Math.min(1, Math.max(0, hpShare))));

/** Heads in the boarding party, and its strength once the captain's boarding bonus is counted. */
export const partyHeads = (crew: number): number => Math.floor(crew * COMPANY.boardingShare);

/** Chance 0…1 the party wins (Lanchester's square law on the two strengths), for the HUD. */
export function boardingOdds(party: number, defenders: number): number {
  if (party <= 0) return 0;
  const a = party * party;
  return a / (a + defenders * defenders);
}

export interface BoardingOutcome {
  won: boolean;
  /** Share 0…1 of the boarding party that died. */
  lossShare: number;
}

/**
 * Fight it out in rounds, each side killing a tenth of the other's strength (± a third, from `rng`) until one is
 * gone. The party's losses are the share of its strength it lost: all of it when beaten.
 */
export function resolveBoarding(party: number, defenders: number, rng: () => number): BoardingOutcome {
  let a = party;
  let d = defenders;
  for (let i = 0; i < 200 && a > 0.5 && d > 0.5; i++) {
    const na = a - d * 0.1 * (0.67 + rng() * 0.66);
    d -= a * 0.1 * (0.67 + rng() * 0.66);
    a = na;
  }
  const won = d <= 0.5 && a > 0.5;
  return { won, lossShare: won && party > 0 ? 1 - Math.max(0, a) / party : 1 };
}

export interface Loot {
  gold: number;
  goods: Record<string, number>;
}

/** What the prize yields: gold by price, and one to three goods filling at most `freeSpace` of the hold. */
export function lootOf(spec: ShipSpec, bonus: number, freeSpace: number, rng: () => number): Loot {
  const gold = Math.round(spec.stats.price * 1000 * BOARDING.lootShare * (0.5 + rng()) * bonus);
  const goods: Record<string, number> = {};
  let space = Math.max(0, Math.floor(freeSpace));
  const kinds = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < kinds && space > 0; k++) {
    const good = GOODS[Math.floor(rng() * GOODS.length)];
    if (!good) continue;
    const qty = Math.min(space, Math.max(1, Math.round(spec.stats.hold * (0.1 + rng() * 0.2))));
    goods[good.id] = (goods[good.id] ?? 0) + qty;
    space -= qty;
  }
  return { gold, goods };
}
