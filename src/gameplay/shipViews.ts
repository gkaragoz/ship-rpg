import type { EnemyView, OtherShipView, WindView } from '../core';
import { COMBAT } from './combat';
import type { Enemy } from './enemy';
import { enemyView } from './enemyView';
import type { Consort } from './fleet';
import type { PlayerShip } from './sailing';
import type { createShipCrews } from './shipCrews';

type ShipCrews = ReturnType<typeof createShipCrews>;

/** The enemies, the consorts and the other ships as the view carries them, each with the sailors on its deck while it is near. */
export function shipViews(
  crews: ShipCrews,
  from: PlayerShip,
  feel: (s: { x: number; z: number }) => WindView,
  enemies: readonly Enemy[],
  consorts: readonly Consort[],
  others: readonly OtherShipView[],
): { enemies: EnemyView[]; consorts: EnemyView[]; others: OtherShipView[] } {
  const hull = (prefix: string, e: Enemy, reloadSeconds: number): EnemyView => {
    const v = enemyView(e, from, feel(e.ship));
    const crew = crews.view(`${prefix}:${e.id}`, { specId: e.spec.id, rudder: e.ship.rudder, sailTarget: e.ship.sailTarget, reload: e.reload, reloadSeconds }, v.distance);
    return crew ? { ...v, crew } : v;
  };
  return {
    enemies: enemies.map((e) => hull('e', e, COMBAT.enemyReload)),
    consorts: consorts.map((c) => hull('c', c, COMBAT.playerReload)),
    others: others.map((o) => {
      const crew = crews.view(`o:${o.id}`, { specId: o.specId, rudder: 0, sailTarget: o.sailLevel }, Math.hypot(o.x - from.x, o.z - from.z));
      return crew ? { ...o, crew } : o;
    }),
  };
}
