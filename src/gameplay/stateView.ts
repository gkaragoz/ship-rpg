import type { CaptainView, CargoView, CompanyView } from '../core';
import type { ShipSpec } from '../ships';
import type { GameState } from './state';
import { cloneState } from './state';
import type { PlayerShip } from './sailing';

/** The captain's purse and standing for the HUD (levels arrive with the progression rules). */
export const captainView = (st: GameState): CaptainView => ({
  gold: st.captain.gold,
  xp: st.captain.xp,
  level: 1,
  xpIntoLevel: st.captain.xp,
  xpForNext: 100,
  kills: st.captain.kills,
});

export function cargoView(st: GameState, spec: ShipSpec): CargoView {
  const items = Object.entries(st.hold)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ id, qty }));
  return { used: items.reduce((n, i) => n + i.qty, 0), capacity: spec.stats.hold, items };
}

export const companyView = (st: GameState, spec: ShipSpec): CompanyView => ({
  count: st.crew,
  max: spec.stats.crew,
  factor: spec.stats.crew > 0 ? Math.min(1, st.crew / spec.stats.crew) : 1,
});

/** A copy of the run's state with the live parts (ship, pose, discoveries, time) read from the game. */
export function snapshot(
  st: GameState,
  live: { spec: ShipSpec; hp: number; ship: PlayerShip; dockedAt: string | null; islands: readonly string[]; ports: readonly string[]; time: number },
): GameState {
  const { spec, hp, ship } = live;
  return {
    ...cloneState(st),
    ship: { specId: spec.id, hp, rigging: ship.rigging, flooding: ship.flooding, fire: ship.fire },
    pose: { x: ship.x, z: ship.z, heading: ship.heading, dockedAt: live.dockedAt },
    discovered: { islands: [...live.islands], ports: [...live.ports] },
    time: live.time,
  };
}
