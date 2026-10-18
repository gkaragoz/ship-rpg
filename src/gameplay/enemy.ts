import { angleDiff, clamp } from '../core';
import type { Controls, WindView } from '../core';
import { SHIP_SPECS, type ShipSpec } from '../ships';
import { COMBAT, type Side } from './combat';
import { createPlayerShip, isBlocked, type PlayerShip } from './sailing';

/** Enemy hull strength as a fraction of its type's listed value: the player has no aim aid yet. */
export const ENEMY_HULL_FACTOR = 0.7;

export interface Enemy {
  id: string;
  spec: ShipSpec;
  ship: PlayerShip;
  hp: number;
  maxHp: number;
  reload: { port: number; starboard: number };
  /** Seconds since it began to sink; -1 while afloat. */
  sinking: number;
  /** Hull too damaged: breaks off and runs. Stays set. */
  fleeing: boolean;
  /** Seconds spent beyond `LOSE_RANGE` of the player. */
  lostFor: number;
  /** Gave up or got away: removed from play this step. */
  gone: boolean;
}

/** The enemy fights on the same sailing model as the player, driven by `aiStep`. */
export function createEnemy(id: string, spec: ShipSpec, x: number, z: number, heading: number): Enemy {
  const ship = createPlayerShip(x, z, heading);
  ship.sailTarget = 1;
  ship.sailLevel = 1;
  const maxHp = Math.round(spec.stats.hp * ENEMY_HULL_FACTOR);
  return { id, spec, ship, hp: maxHp, maxHp, reload: { port: COMBAT.enemyReload / 2, starboard: COMBAT.enemyReload / 2 }, sinking: -1, fleeing: false, lostFor: 0, gone: false };
}

/** A gunned ship whose hull strength is the closest to 80% of the player's. */
export function pickEnemySpec(player: ShipSpec): ShipSpec {
  const wanted = player.stats.hp * 0.8;
  const armed = SHIP_SPECS.filter((s) => s.stats.cannons >= 8);
  let best = armed[0] ?? player;
  for (const s of armed) {
    if (Math.abs(s.stats.hp - wanted) < Math.abs(best.stats.hp - wanted)) best = s;
  }
  return best;
}

const BROADSIDE_ANGLE = Math.PI / 2;
/** Fire when the target is this close to dead abeam (rad) and within this range (m). */
const FIRE_CONE = 0.35;
const FIRE_RANGE = 180;
/** Inside this the enemy stops closing and runs parallel to the player. */
const PARALLEL_RANGE = 130;
const CLOSE_IN = 300;
const NO_GO = 0.75;
/** Below this fraction of its hull an enemy breaks off. */
export const FLEE_HULL = 0.25;
/** Farther than this from the player counts as having lost him; after `LOSE_SECONDS` of it the enemy gives up. */
export const LOSE_RANGE = 1500;
export const LOSE_SECONDS = 30;

/**
 * Track whether the enemy has lost the player: call every step with the distance. Returns true
 * once it has been out of range for `LOSE_SECONDS`; coming back into range starts the count over.
 */
export function lostTrack(e: Enemy, distance: number, dt: number): boolean {
  e.lostFor = distance > LOSE_RANGE ? e.lostFor + dt : 0;
  return e.lostFor >= LOSE_SECONDS;
}

export interface AiResult {
  controls: Controls;
  fire: Side | null;
}

/** Close in on the player, turn broadside at about 150 m and fire; stay off the wind and the shore. */
export function aiStep(e: Enemy, player: Pick<PlayerShip, 'x' | 'z'>, wind: WindView): AiResult {
  const s = e.ship;
  const dx = player.x - e.ship.x;
  const dz = player.z - e.ship.z;
  const dist = Math.hypot(dx, dz);
  const toPlayer = Math.atan2(-dz, dx);
  // > 0: the player is on our port side.
  const rel = angleDiff(toPlayer, s.heading);

  if (!e.fleeing && e.hp < e.maxHp * FLEE_HULL) e.fleeing = true;

  let desired = toPlayer;
  if (e.fleeing) {
    desired = toPlayer + Math.PI; // run directly away
  } else if (dist < CLOSE_IN) {
    const closing = dist > PARALLEL_RANGE ? 0.45 : 0;
    desired = rel >= 0 ? toPlayer - (BROADSIDE_ANGLE - closing) : toPlayer + (BROADSIDE_ANGLE - closing);
  }

  // Never sail into the wind: bear off to whichever side is closer.
  const offWind = angleDiff(desired, wind.from);
  if (Math.abs(offWind) < NO_GO) desired = wind.from + (offWind >= 0 ? 1 : -1) * (NO_GO + 0.1);

  // Look ahead for shoals and turn toward the clearer side.
  const probe = (angle: number, ahead: number): boolean =>
    isBlocked({ x: s.x + Math.cos(angle) * ahead, z: s.z - Math.sin(angle) * ahead, heading: angle }, e.spec);
  if (probe(s.heading, 90) || probe(desired, 90)) {
    const leftClear = !probe(s.heading + 0.7, 90);
    desired = s.heading + (leftClear ? 0.9 : -0.9);
  }

  const rudder = clamp(angleDiff(s.heading, desired) * 2.5, -1, 1);
  const sailStep = s.sailTarget < 1 ? 1 : 0;

  let fire: Side | null = null;
  if (!e.fleeing && dist < FIRE_RANGE) {
    if (Math.abs(rel - BROADSIDE_ANGLE) < FIRE_CONE && e.reload.port <= 0) fire = 'port';
    else if (Math.abs(rel + BROADSIDE_ANGLE) < FIRE_CONE && e.reload.starboard <= 0) fire = 'starboard';
  }
  return { controls: { rudder, sailStep }, fire };
}
