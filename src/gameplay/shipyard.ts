import type { CommandResult, PortCommand, ShipOfferView, ShipyardView } from '../core';
import { SHIP_SPECS, getShipSpec, type ShipSpec } from '../ships';
import { PORT_ECONOMY } from '../world';
import { holdUsed, type GameState } from './state';

/** Prices and rules of the shipyard. A ship's `stats.price` is in thousands of gold. */
export const YARD = {
  /** Gold per `price` point. */
  goldPerPrice: 1000,
  /** The yard buys your ship for this share of its price, scaled by its condition (hull share × 0.6 + 0.4). */
  tradeInShare: 0.5,
  /** Repair costs this share of the price for a hull from 0 to full (never less than what the yard adds to its offer for your ship, so mending before selling does not pay), and a little for the rigging. */
  hullRepairShare: 0.3,
  riggingRepairShare: 0.05,
} as const;

export const offerPrice = (spec: ShipSpec): number => spec.stats.price * YARD.goldPerPrice;

/** What the yard pays for the ship you sail, by its hull. */
export const tradeInValue = (st: GameState, spec: ShipSpec): number =>
  Math.round(offerPrice(spec) * YARD.tradeInShare * (0.4 + 0.6 * Math.min(1, Math.max(0, st.ship.hp / spec.stats.hp))));

/** Gold for a full repair of the hull and rigging (flooding and fire are put right with them). */
export function repairCost(st: GameState, spec: ShipSpec): number {
  const hull = 1 - Math.min(1, Math.max(0, st.ship.hp / spec.stats.hp));
  const rig = 1 - Math.min(1, Math.max(0, st.ship.rigging));
  return Math.ceil(offerPrice(spec) * (YARD.hullRepairShare * hull + YARD.riggingRepairShare * rig));
}

/** The ships a port's yard sells: its best class and every smaller one. */
export const yardOffers = (portId: string): ShipSpec[] => {
  const best = PORT_ECONOMY[portId]?.yardClass ?? 7;
  return SHIP_SPECS.filter((s) => s.stats.rank >= best).sort((a, b) => a.stats.price - b.stats.price);
};

/** Why a ship cannot be bought now (a code the UI words), or null. */
export function whyNot(st: GameState, current: ShipSpec, portId: string, target: ShipSpec): string | null {
  if (!yardOffers(portId).some((s) => s.id === target.id)) return 'not-sold';
  if (target.id === current.id) return 'same-ship';
  if (holdUsed(st.hold) > target.stats.hold) return 'hold-too-small';
  if (offerPrice(target) - tradeInValue(st, current) > st.captain.gold) return 'no-gold';
  return null;
}

/** Make the purchase on the run's state: the new ship comes whole, the crew shrinks to fit, the old ship goes in part exchange. */
export function buyShip(st: GameState, current: ShipSpec, portId: string, specId: string): { ok: boolean; reason?: string; spec?: ShipSpec } {
  const target = getShipSpec(specId);
  if (!target) return { ok: false, reason: 'not-sold' };
  const reason = whyNot(st, current, portId, target);
  if (reason) return { ok: false, reason };
  st.captain.gold -= offerPrice(target) - tradeInValue(st, current);
  st.ship = { specId: target.id, hp: target.stats.hp, rigging: 1, flooding: 0, fire: 0 };
  st.crew = Math.min(st.crew, target.stats.crew);
  return { ok: true, spec: target };
}

export function shipyardView(st: GameState, current: ShipSpec, portId: string): ShipyardView {
  const trade = tradeInValue(st, current);
  const offers: ShipOfferView[] = yardOffers(portId).map((s) => {
    const reason = whyNot(st, current, portId, s);
    return {
      specId: s.id,
      name: s.name,
      price: offerPrice(s),
      net: offerPrice(s) - trade,
      hp: s.stats.hp,
      speed: s.stats.speed,
      turn: s.stats.turn,
      hold: s.stats.hold,
      crew: s.stats.crew,
      cannons: s.stats.cannons,
      trim: Math.max(0, st.crew - s.stats.crew),
      current: s.id === current.id,
      reason: reason ?? undefined,
    };
  });
  return { tradeIn: trade, repairCost: repairCost(st, current), offers };
}

/**
 * The yard's two commands, on the run's state (whose `ship` must be current): a repair mends everything for gold, a
 * purchase swaps the ship. `equip` is told the ship the captain now sails so the game can rebuild what hangs on it.
 */
export function runYard(st: GameState, spec: ShipSpec, portId: string | null, cmd: PortCommand, equip: (spec: ShipSpec) => void): CommandResult {
  if (!portId) return { ok: false, reason: 'not-docked' };
  if (cmd.type === 'repair') {
    const cost = repairCost(st, spec);
    if (cost <= 0) return { ok: false, reason: 'nothing-to-repair' };
    if (cost > st.captain.gold) return { ok: false, reason: 'no-gold' };
    st.captain.gold -= cost;
    st.ship = { specId: spec.id, hp: spec.stats.hp, rigging: 1, flooding: 0, fire: 0 };
    equip(spec);
    return { ok: true };
  }
  if (cmd.type !== 'buyShip') return { ok: false, reason: 'bad-qty' };
  const r = buyShip(st, spec, portId, cmd.specId);
  if (r.ok && r.spec) equip(r.spec);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}
