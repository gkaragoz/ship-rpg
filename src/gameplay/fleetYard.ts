import type { CommandResult, FleetShipView, PortCommand } from '../core';
import { clamp } from '../core';
import { getShipSpec, type ShipSpec } from '../ships';
import { YARD, offerPrice, yardOffers } from './shipyard';
import { MAX_CONSORTS, holdUsed, type FleetEntry, type GameState } from './state';

/** What keeping a fleet costs and how a captured ship comes: all in gold and shares. */
export const FLEET = {
  /** A consort's upkeep: this share of its price per `upkeepSeconds` of game time, paid when the fleet reaches a port. */
  upkeepShare: 0.0025,
  upkeepSeconds: 600,
  /** A captured ship comes with this share of its crew (the prize crew the party can spare). */
  captureCrew: 0.5,
  /** What the yard pays for a consort, like for the flagship (`YARD.tradeInShare`): this share of its price scaled by its hull. */
  sellShare: 0.5,
} as const;

const hullShare = (e: FleetEntry, spec: ShipSpec): number => clamp(e.hp / spec.stats.hp, 0, 1);

/** Gold the yard pays for a consort. */
export const consortSellPrice = (e: FleetEntry, spec: ShipSpec): number => Math.round(offerPrice(spec) * FLEET.sellShare * (0.4 + 0.6 * hullShare(e, spec)));

/** Gold for a full repair of a consort (hull and rigging, as for the flagship). */
export function consortRepairCost(e: FleetEntry, spec: ShipSpec): number {
  const rig = 1 - clamp(e.rigging, 0, 1);
  return Math.ceil(offerPrice(spec) * (YARD.hullRepairShare * (1 - hullShare(e, spec)) + YARD.riggingRepairShare * rig));
}

/** Why a ship cannot join the fleet now (a code the UI words), or null. */
export function whyNotConsort(st: GameState, portId: string, target: ShipSpec): string | null {
  if (!yardOffers(portId).some((s) => s.id === target.id)) return 'not-sold';
  if (st.fleet.length >= MAX_CONSORTS) return 'fleet-full';
  if (offerPrice(target) > st.captain.gold) return 'no-gold';
  return null;
}

/** The consorts as the port panel lists them. */
export function fleetViews(st: GameState): FleetShipView[] {
  const out: FleetShipView[] = [];
  st.fleet.forEach((e, index) => {
    const spec = getShipSpec(e.specId);
    if (!spec) return;
    out.push({
      index, specId: spec.id, name: spec.name, hp: e.hp, maxHp: spec.stats.hp, rigging: e.rigging, crew: e.crew, maxCrew: spec.stats.crew,
      repairCost: consortRepairCost(e, spec), sellPrice: consortSellPrice(e, spec),
    });
  });
  return out;
}

/** A ship taken in battle joins the fleet: its hull as it was, a prize crew aboard. Returns false when the fleet is full. */
export function addPrize(st: GameState, spec: ShipSpec, hp: number): boolean {
  if (st.fleet.length >= MAX_CONSORTS) return false;
  st.fleet.push({ specId: spec.id, hp: clamp(Math.round(hp), 1, spec.stats.hp), rigging: 0.6, crew: Math.max(1, Math.ceil(spec.stats.crew * FLEET.captureCrew)) });
  return true;
}

/** Pay the fleet's upkeep for the game time since it was last paid; returns the gold taken (never more than the captain has). */
export function chargeUpkeep(st: GameState, now: number): number {
  const elapsed = Math.max(0, now - st.upkeepAt);
  st.upkeepAt = now;
  if (st.fleet.length === 0) return 0;
  let owed = 0;
  for (const e of st.fleet) {
    const spec = getShipSpec(e.specId);
    if (spec) owed += offerPrice(spec) * FLEET.upkeepShare * (elapsed / FLEET.upkeepSeconds);
  }
  const paid = Math.min(st.captain.gold, Math.round(owed));
  st.captain.gold -= paid;
  return paid;
}

/**
 * The fleet commands of the yard, on the run's state: buy a ship as a consort, sell or repair one, or move the flag to
 * one (swapping it with the flagship). `equip` is told the ship the captain sails after a flag swap.
 */
export function runFleetYard(st: GameState, flagship: ShipSpec, portId: string | null, cmd: PortCommand, equip: (spec: ShipSpec) => void): CommandResult {
  if (!portId) return { ok: false, reason: 'not-docked' };
  if (cmd.type === 'buyConsort') {
    const target = getShipSpec(cmd.specId);
    if (!target) return { ok: false, reason: 'not-sold' };
    const reason = whyNotConsort(st, portId, target);
    if (reason) return { ok: false, reason };
    st.captain.gold -= offerPrice(target);
    st.fleet.push({ specId: target.id, hp: target.stats.hp, rigging: 1, crew: target.stats.crew });
    return { ok: true };
  }
  if (cmd.type !== 'sellConsort' && cmd.type !== 'repairConsort' && cmd.type !== 'flagship') return { ok: false, reason: 'bad-qty' };
  const entry = st.fleet[cmd.index];
  const spec = entry && getShipSpec(entry.specId);
  if (!entry || !spec) return { ok: false, reason: 'no-such-ship' };
  if (cmd.type === 'sellConsort') {
    st.captain.gold += consortSellPrice(entry, spec);
    st.fleet.splice(cmd.index, 1);
    return { ok: true };
  }
  if (cmd.type === 'repairConsort') {
    const cost = consortRepairCost(entry, spec);
    if (cost <= 0) return { ok: false, reason: 'nothing-to-repair' };
    if (cost > st.captain.gold) return { ok: false, reason: 'no-gold' };
    st.captain.gold -= cost;
    entry.hp = spec.stats.hp;
    entry.rigging = 1;
    return { ok: true };
  }
  // flagship: the consort becomes the ship the captain sails, the old flagship takes its place in the fleet
  if (holdUsed(st.hold) > spec.stats.hold) return { ok: false, reason: 'hold-too-small' };
  const old: FleetEntry = { specId: flagship.id, hp: st.ship.hp, rigging: st.ship.rigging, crew: st.crew };
  st.ship = { specId: spec.id, hp: entry.hp, rigging: entry.rigging, flooding: 0, fire: 0 };
  st.crew = Math.min(entry.crew, spec.stats.crew);
  st.fleet[cmd.index] = old;
  equip(spec);
  return { ok: true };
}
