import type { BoardingView, CaptainView, CargoView, CompanyView } from '../core';
import type { ShipSpec } from '../ships';
import type { GameState } from './state';
import { cloneState, holdUsed } from './state';
import { crewFactor } from './company';
import { levelProgress } from './progression';
import { getPort, type Port } from '../world';
import type { Enemy } from './enemy';
import { BOARDING } from './boarding';
import { oddsAgainst } from './plunder';
import type { PlayerShip } from './sailing';

/** The captain's purse and standing for the HUD. */
export function captainView(st: GameState): CaptainView {
  const p = levelProgress(st.captain.xp);
  return { gold: st.captain.gold, xp: st.captain.xp, level: p.level, xpIntoLevel: p.into, xpForNext: p.span, kills: st.captain.kills };
}

export function cargoView(st: GameState, spec: ShipSpec): CargoView {
  const items = Object.entries(st.hold)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ id, qty }));
  return { used: holdUsed(st.hold), capacity: spec.stats.hold, items };
}

export const companyView = (st: GameState, spec: ShipSpec): CompanyView => ({
  count: st.crew,
  max: spec.stats.crew,
  factor: crewFactor(st.crew, spec.stats.crew),
});

export function boardingView(st: GameState, prize: Enemy | null, cooldown: number): BoardingView {
  return { available: !!prize && cooldown <= 0, targetId: prize?.id ?? null, odds: prize ? oddsAgainst(prize, st) : 0, cooldown: Math.max(0, Math.min(cooldown, BOARDING.cooldown)) };
}

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

/** Put a resumed run's ship back as it was (condition, mooring); returns the port it is moored at. */
export function restoreShip(ship: PlayerShip, st: GameState): Port | null {
  ship.rigging = st.ship.rigging;
  ship.flooding = st.ship.flooding;
  ship.fire = st.ship.fire;
  ship.spin = 0;
  const port = st.pose.dockedAt ? getPort(st.pose.dockedAt) : undefined;
  ship.docked = !!port;
  return port ?? null;
}
