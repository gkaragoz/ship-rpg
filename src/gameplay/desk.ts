import type { GameEvent, HitZone } from '../core';
import type { ShipSpec } from '../ships';
import { BOARDING } from './boarding';
import { casualties, playerReloadSeconds } from './company';
import type { Enemy } from './enemy';
import { board, findPrize } from './plunder';
import type { PlayerShip } from './sailing';
import { levelFor } from './progression';
import type { GameState } from './state';

/** The captain's side of the game: crew losses, reload from the company, boarding and the price of going down. */
export interface Desk {
  level(): number;
  reloadSeconds(): number;
  /** A hit of `lost` hull points on a ship of `maxHp` kills sailors too; the remainders carry over. */
  loseCrew(lost: number, maxHp: number, zone: HitZone): void;
  /** Count the boarding cooldown down. */
  tick(dt: number): void;
  cooldown(): number;
  /** The enemy alongside that could be boarded now, if any. */
  prize(ship: PlayerShip, enemies: readonly Enemy[]): Enemy | null;
  /** Try to board; returns the prize when it was taken (the caller scuttles it). */
  attempt(ship: PlayerShip, enemies: readonly Enemy[], rng: () => number, events: GameEvent[]): Enemy | null;
  /** The cost of being sunk: cargo and a quarter of the gold are lost, half the crew is signed on again. */
  sunkPenalty(): void;
}

export function createDesk(st: GameState, spec: () => ShipSpec): Desk {
  let cooldown = 0;
  let acc = 0;
  const level = (): number => levelFor(st.captain.xp);
  return {
    level,
    reloadSeconds: () => playerReloadSeconds(st.crew, spec().stats.crew, level()),
    loseCrew(lost, maxHp, zone): void {
      acc += casualties(lost, maxHp, st.crew, zone);
      const dead = Math.min(st.crew, Math.floor(acc));
      acc -= dead;
      st.crew -= dead;
    },
    tick: (dt) => void (cooldown = Math.max(0, cooldown - dt)),
    cooldown: () => cooldown,
    prize: (ship, enemies) => findPrize(ship, spec(), enemies, st.crew),
    attempt(ship, enemies, rng, events): Enemy | null {
      const prize = cooldown > 0 ? null : findPrize(ship, spec(), enemies, st.crew);
      if (!prize) return null;
      if (board(st, spec(), prize, rng, events)) return prize;
      cooldown = BOARDING.cooldown;
      return null;
    },
    sunkPenalty(): void {
      st.hold = {};
      st.captain.gold = Math.floor(st.captain.gold * 0.75);
      st.crew = Math.max(st.crew, Math.ceil(spec().stats.crew * 0.5));
    },
  };
}
