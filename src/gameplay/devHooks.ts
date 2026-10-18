import type { Game } from './game';
import type { Enemy } from './enemy';
import type { PlayerShip } from './sailing';

/** What the dev hooks need to reach into the running game. */
export interface DevAccess {
  ship: () => PlayerShip;
  enemies: () => readonly Enemy[];
  setKills(n: number): void;
  setSea(state: number | null): void;
  discover(): void;
}

const unit = (v: number): number => Math.min(Math.max(v, 0), 1);

/** Hooks for tests and for poking at the game from the browser console in dev; the game never calls them. */
export function createDevHooks(a: DevAccess): Game['dev'] {
  return {
    damageEnemies(fraction): void {
      for (const e of a.enemies()) if (e.sinking < 0) e.hp = Math.max(1, Math.round(e.maxHp * fraction));
    },
    teleportPlayer(x, z): void {
      const ship = a.ship();
      ship.x = x;
      ship.z = z;
      a.discover();
    },
    setKills: (n) => a.setKills(n),
    setRigging(fraction): void {
      a.ship().rigging = unit(fraction);
    },
    setSea: (state) => a.setSea(state === null ? null : unit(state)),
    setAffliction(flooding, fire): void {
      const ship = a.ship();
      ship.flooding = unit(flooding);
      ship.fire = unit(fire);
    },
  };
}
