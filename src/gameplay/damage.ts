import type { HitZone } from '../core';
import { clamp, lerp } from '../core';

/**
 * The damage model. A ball strikes a ship at some height, and that decides what it breaks:
 * the rigging above the deck (sails: speed and turning, and it may catch fire), the hull, or the
 * waterline (leaks that flood the ship). Everything here is a pure function so the game and the headless duel
 * simulator share it and `docs/BALANCE.md` measures the real thing.
 */
export const DAMAGE = {
  /** A ball hitting the rigging does this share of its hull damage: the sails take the blow. */
  riggingHullShare: 0.3,
  /** Rigging health lost per hull-strength fraction of damage: 40 damage on a 2500 hull is 1.6% of it, so ~4.8% of the rigging. */
  riggingPerHull: 3,
  /** At rigging 0 a ship still makes this fraction of its speed (jury rig, tattered sails) and keeps this much turning. */
  speedFloor: 0.35,
  turnFloor: 0.55,
  /** Rigging repaired per second at sea (a crew mending sails, up to `seaRepairCap`) and moored in harbour. */
  seaRepair: 0.0015,
  seaRepairCap: 0.7,
  dockRepair: 0.03,
  /** Flooding (0 dry … 1 swamped) added per hull-strength fraction of a waterline hit: 40 damage on a 2500 hull is ~10%. */
  floodPerHull: 6,
  /** Hull strength lost per second, as a share of the maximum, at flooding 1 (and at fire 1). */
  floodDrain: 0.003,
  fireBurn: 0.002,
  /** Swamped, a ship still makes this fraction of its speed. */
  floodSpeedFloor: 0.55,
  /** Flooding the crew pumps out per second at sea and in harbour. */
  pump: 0.003,
  dockPump: 0.05,
  /** Chance that a hit starts a fire, by zone (a waterline hit never does); the fire it starts. */
  igniteRigging: 0.15,
  igniteHull: 0.06,
  igniteLevel: 0.35,
  /** Rigging burnt per second at fire 1. */
  fireRigging: 0.01,
  /** Fire the crew puts out per second at sea, and in harbour. */
  fireOut: 0.02,
  dockFireOut: 0.5,
} as const;

/** The height above the sea below which a ball strikes the waterline. */
export const WATERLINE_BAND = 0.8;

export interface HitEffect {
  /** Hull points lost. */
  hull: number;
  /** Rigging health lost, 0…1 of a full set of sails. */
  rigging: number;
  /** Flooding added, 0…1 of a swamped ship. */
  flood: number;
}

/** What a hit of `damage` (before zone scaling) does to a ship whose full hull strength is `maxHull`. */
export function hitEffect(zone: HitZone, damage: number, maxHull: number): HitEffect {
  if (zone === 'rigging') {
    return { hull: damage * DAMAGE.riggingHullShare, rigging: (damage / Math.max(maxHull, 1)) * DAMAGE.riggingPerHull, flood: 0 };
  }
  const flood = zone === 'waterline' ? (damage / Math.max(maxHull, 1)) * DAMAGE.floodPerHull : 0;
  return { hull: damage, rigging: 0, flood };
}

/** The condition a ship carries besides its hull points: all 0…1, rigging 1 = intact, flooding and fire 0 = none. */
export interface Afflicted {
  rigging: number;
  flooding: number;
  fire: number;
}

/**
 * Apply a hit to a ship's condition and return the hull points it costs. `roll` is a random number in [0, 1)
 * that decides whether the hit starts a fire; callers draw it for every hit so random streams stay aligned.
 */
export function strike(ship: Afflicted, zone: HitZone, damage: number, maxHull: number, roll: number): number {
  const fx = hitEffect(zone, damage, maxHull);
  ship.rigging = Math.max(0, ship.rigging - fx.rigging);
  ship.flooding = Math.min(1, ship.flooding + fx.flood);
  const chance = zone === 'rigging' ? DAMAGE.igniteRigging : zone === 'hull' ? DAMAGE.igniteHull : 0;
  if (roll < chance) ship.fire = Math.min(1, Math.max(ship.fire, DAMAGE.igniteLevel) + 0.1);
  return fx.hull;
}

/**
 * Advance leaks and fire by `dt`: the crew pumps and fights the fire (far faster in harbour), flames eat the
 * rigging. Returns the hull points lost to water and flames in this step.
 */
export function stepAffliction(ship: Afflicted, maxHull: number, docked: boolean, dt: number): number {
  const lost = (ship.flooding * DAMAGE.floodDrain + ship.fire * DAMAGE.fireBurn) * maxHull * dt;
  ship.rigging = Math.max(0, ship.rigging - ship.fire * DAMAGE.fireRigging * dt);
  ship.flooding = Math.max(0, ship.flooding - (docked ? DAMAGE.dockPump : DAMAGE.pump) * dt);
  ship.fire = Math.max(0, ship.fire - (docked ? DAMAGE.dockFireOut : DAMAGE.fireOut) * dt);
  return lost;
}

/** Speed multiplier from a ship that is taking on water: 1 dry, `floodSpeedFloor` swamped. */
export const floodSpeedFactor = (flooding: number): number => lerp(1, DAMAGE.floodSpeedFloor, clamp(flooding, 0, 1));

/** Speed multiplier from the state of the sails: 1 intact, `speedFloor` wrecked. */
export const riggingSpeedFactor = (rigging: number): number => lerp(DAMAGE.speedFloor, 1, clamp(rigging, 0, 1));

/** Turning multiplier from the state of the rigging: 1 intact, `turnFloor` wrecked. */
export const riggingTurnFactor = (rigging: number): number => lerp(DAMAGE.turnFloor, 1, clamp(rigging, 0, 1));

/** Rigging after `dt` seconds of mending: fast in harbour, slow and only part-way at sea. */
export function repairRigging(rigging: number, docked: boolean, dt: number): number {
  if (docked) return Math.min(1, rigging + DAMAGE.dockRepair * dt);
  return rigging < DAMAGE.seaRepairCap ? Math.min(DAMAGE.seaRepairCap, rigging + DAMAGE.seaRepair * dt) : rigging;
}
