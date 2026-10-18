import type { GameEvent } from '../core';
import type { ShipSpec } from '../ships';
import { BOARDING, boardingOdds, enemyCrewOf, lootOf, partyHeads, resolveBoarding } from './boarding';
import type { Enemy } from './enemy';
import { strength } from './enemy';
import type { PlayerShip } from './sailing';
import { boardingBonus, levelFor, lootBonus, xpForKill } from './progression';
import { holdUsed, type GameState } from './state';

const velocity = (s: PlayerShip): { x: number; z: number } => ({ x: Math.cos(s.heading) * s.speed, z: -Math.sin(s.heading) * s.speed });

/** The crippled enemy alongside that the player could board right now, if any (the nearest one). */
export function findPrize(ship: PlayerShip, spec: ShipSpec, enemies: readonly Enemy[], crew: number): Enemy | null {
  if (partyHeads(crew) < 1) return null;
  const mine = velocity(ship);
  let best: Enemy | null = null;
  let bestDistance = Infinity;
  for (const e of enemies) {
    if (e.sinking >= 0 || e.gone) continue;
    if (!e.fleeing && e.hp > e.maxHp * BOARDING.maxHullShare) continue;
    const distance = Math.hypot(e.ship.x - ship.x, e.ship.z - ship.z);
    if (distance > (spec.length + e.spec.length) * 0.25 + BOARDING.reach) continue;
    const theirs = velocity(e.ship);
    if (Math.hypot(theirs.x - mine.x, theirs.z - mine.z) > BOARDING.maxRelSpeed) continue;
    if (distance < bestDistance) {
      best = e;
      bestDistance = distance;
    }
  }
  return best;
}

/** Chance the boarding party takes the prize. */
export function oddsAgainst(prize: Enemy, st: GameState): number {
  const level = levelFor(st.captain.xp);
  return boardingOdds(partyHeads(st.crew) * boardingBonus(level), enemyCrewOf(prize.spec, prize.hp / prize.maxHp));
}

/** Add experience, announcing each level reached. */
export function awardXp(st: GameState, xp: number, at: { x: number; z: number }, events: GameEvent[]): void {
  const before = levelFor(st.captain.xp);
  st.captain.xp += xp;
  const after = levelFor(st.captain.xp);
  if (after > before) events.push({ type: 'levelup', owner: 'player', x: at.x, y: 0, z: at.z, level: after });
}

/** Experience for a ship sunk or taken. */
export const killXp = (e: Enemy, boarded: boolean): number => xpForKill(strength(e.spec), boarded);

/**
 * Board the prize: the party fights its crew. A win takes gold and goods (as much as fits) and the prize is lost
 * to the sea; a defeat costs the whole party. Mutates `st` and returns whether the prize was taken.
 */
export function board(st: GameState, spec: ShipSpec, prize: Enemy, rng: () => number, events: GameEvent[]): boolean {
  const level = levelFor(st.captain.xp);
  const heads = partyHeads(st.crew);
  const party = heads * boardingBonus(level);
  const out = resolveBoarding(party, enemyCrewOf(prize.spec, prize.hp / prize.maxHp), rng);
  const lost = Math.min(st.crew, Math.round(heads * out.lossShare));
  st.crew -= lost;
  const at = { x: prize.ship.x, y: 0, z: prize.ship.z };
  events.push({ type: 'boarded', owner: 'player', ...at, won: out.won, amount: lost });
  if (!out.won) return false;
  const loot = lootOf(prize.spec, lootBonus(level), spec.stats.hold - holdUsed(st.hold), rng);
  st.captain.gold += loot.gold;
  let goods = 0;
  for (const [id, qty] of Object.entries(loot.goods)) {
    st.hold[id] = (st.hold[id] ?? 0) + qty;
    goods += qty;
  }
  events.push({ type: 'loot', owner: 'player', ...at, gold: loot.gold, amount: goods });
  return true;
}
