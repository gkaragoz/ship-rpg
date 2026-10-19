import { NAVIES, REPUTATION, atWar, enemiesOf, type Port } from '../world';
import { clamp } from '../core';
import type { GameState } from './state';

/** The numbers of the captain's standing: what a fight costs and earns, when a port shuts, and how it fades. */
export const REP = {
  /** Sinking or taking a ship of a nation costs this much with it. */
  killPenalty: 12,
  /** ... and wins this much with each navy at war with it (and with every navy for a pirate). */
  enemyBonus: 4,
  pirateBonus: 3,
  /** At or below this a navy's port will not let the captain in; at or below `hostile` its ships hunt him. */
  portClosed: -50,
  hostile: -20,
  /** Standing fades towards 0 by this much every this many game seconds. */
  fadeBy: 1,
  fadeEvery: 300,
} as const;

/** How standing moves a navy port's prices: friends are treated better, a hated captain pays more and is paid less. */
export const PRICE = { friend: 40, buyFriend: 0.95, sellFriend: 1.02, buyHostile: 1.1, sellHostile: 0.95 } as const;

/** The captain's standing with a nation, -100 … 100. */
export const standing = (st: GameState, nation: string): number => st.reputation[nation] ?? 0;

function change(st: GameState, nation: string, by: number): void {
  if (nation === 'free') return;
  st.reputation[nation] = clamp((st.reputation[nation] ?? 0) + by, REPUTATION.min, REPUTATION.max);
}

/** Reward or penalty in standing (a quest done, a quest failed). */
export const addStanding = change;

/** A ship of `nation` was sunk or taken by the captain: its flag hates him for it, its enemies like him better. */
export function recordKill(st: GameState, nation: string): void {
  if (nation === 'free') return;
  change(st, nation, -REP.killPenalty);
  if (nation === 'pirate') for (const n of NAVIES) change(st, n, REP.pirateBonus);
  else for (const n of enemiesOf(nation)) change(st, n, REP.enemyBonus);
}

/** Is this port closed to the captain? Pirate and free ports take anyone; a navy's port shuts on a hated captain. */
export function portClosed(st: GameState, port: Pick<Port, 'nation'>): boolean {
  return (NAVIES as readonly string[]).includes(port.nation) && standing(st, port.nation) <= REP.portClosed;
}

/**
 * The nation of the next enemy: pirates always, and any navy that is hunting the captain (standing at or below
 * `REP.hostile`); `counter` picks among them in turn, so a hunted captain meets the pirates and each hostile navy.
 */
export function enemyNationFor(st: GameState, counter: number): string {
  const pool = ['pirate', ...NAVIES.filter((n) => standing(st, n) <= REP.hostile)];
  return pool[counter % pool.length] as string;
}

/** Let old grudges and favours fade: call every step with the time that passed; `clock` carries the remainder. */
export function fadeStanding(st: GameState, clock: { t: number }, dt: number): void {
  clock.t += dt;
  while (clock.t >= REP.fadeEvery) {
    clock.t -= REP.fadeEvery;
    for (const n of Object.keys(st.reputation)) {
      const v = st.reputation[n] ?? 0;
      st.reputation[n] = v > 0 ? Math.max(0, v - REP.fadeBy) : Math.min(0, v + REP.fadeBy);
    }
  }
}

/** Whether two flags are at war, re-exported for the rules that need only that. */
export { atWar };

/** The factor on what a port pays or charges for goods, from the captain's standing with its nation (pirate and free ports: 1). */
export function priceFactor(st: GameState, port: Pick<Port, 'nation'> | undefined, side: 'buy' | 'sell'): number {
  if (!port || !(NAVIES as readonly string[]).includes(port.nation)) return 1;
  const v = standing(st, port.nation);
  if (v >= PRICE.friend) return side === 'buy' ? PRICE.buyFriend : PRICE.sellFriend;
  if (v <= REP.hostile) return side === 'buy' ? PRICE.buyHostile : PRICE.sellHostile;
  return 1;
}
