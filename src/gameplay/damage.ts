import type { HitZone } from '../core';
import { clamp, lerp } from '../core';

/**
 * The damage model. A ball strikes a ship at some height, and that decides what it breaks:
 * the rigging above the deck (sails: speed and turning), the hull, or the waterline (leaks,
 * added in 5a.3b). Everything here is a pure function so the game and the headless duel
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
} as const;

/** The height above the sea below which a ball strikes the waterline. */
export const WATERLINE_BAND = 0.8;

export interface HitEffect {
  /** Hull points lost. */
  hull: number;
  /** Rigging health lost, 0…1 of a full set of sails. */
  rigging: number;
}

/** What a hit of `damage` (before zone scaling) does to a ship whose full hull strength is `maxHull`. */
export function hitEffect(zone: HitZone, damage: number, maxHull: number): HitEffect {
  if (zone === 'rigging') {
    return { hull: damage * DAMAGE.riggingHullShare, rigging: (damage / Math.max(maxHull, 1)) * DAMAGE.riggingPerHull };
  }
  return { hull: damage, rigging: 0 };
}

/** Speed multiplier from the state of the sails: 1 intact, `speedFloor` wrecked. */
export const riggingSpeedFactor = (rigging: number): number => lerp(DAMAGE.speedFloor, 1, clamp(rigging, 0, 1));

/** Turning multiplier from the state of the rigging: 1 intact, `turnFloor` wrecked. */
export const riggingTurnFactor = (rigging: number): number => lerp(DAMAGE.turnFloor, 1, clamp(rigging, 0, 1));

/** Rigging after `dt` seconds of mending: fast in harbour, slow and only part-way at sea. */
export function repairRigging(rigging: number, docked: boolean, dt: number): number {
  if (docked) return Math.min(1, rigging + DAMAGE.dockRepair * dt);
  return rigging < DAMAGE.seaRepairCap ? Math.min(DAMAGE.seaRepairCap, rigging + DAMAGE.seaRepair * dt) : rigging;
}
