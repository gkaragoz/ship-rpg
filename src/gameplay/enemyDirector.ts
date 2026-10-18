import { CONFIG } from '../core';
import type { Controls, GameEvent, WindView } from '../core';
import type { ShipSpec } from '../ships';
import { COMBAT, type Side } from './combat';
import { aiStep, desiredEnemies, lostTrack, spawnFor, type Enemy } from './enemy';
import { awardXp, killXp } from './plunder';
import { questKill } from './quests';
import { enemyNationFor, recordKill } from './reputation';
import type { PlayerShip } from './sailing';
import type { GameState } from './state';
import { RESPAWN, STAGGER } from './tuning';

/** What the enemy director needs from the game. */
export interface EnemyDeps {
  st: GameState;
  rng: () => number;
  ship(): PlayerShip;
  spec(): ShipSpec;
  wind(): WindView;
  /** The captain's other ships afloat (the enemies fight whichever of his ships is nearest). */
  consorts(): readonly { ship: PlayerShip; sinking: number }[];
  /** Move an enemy-shaped hull one step (sailing, the sea's motion, leaks and fire). */
  advance(e: Enemy, controls: Controls, dt: number): void;
  /** Order a broadside of an enemy. */
  fire(hull: PlayerShip, spec: ShipSpec, side: Side, alive: () => boolean): void;
  emit(event: GameEvent): void;
  /** The flagship has sunk, or is moored (safe in harbour). */
  sunk(): boolean;
  docked(): boolean;
}

export interface EnemyDirector {
  list(): Enemy[];
  /** Ships sunk this run: how many enemies attack at once (the career count is `st.captain.kills`). */
  kills(): number;
  setKills(n: number): void;
  /** A fresh run: no enemies, the first nation again, one enemy straight away. */
  reset(): void;
  /** The captain changed ships: the enemies were picked for the old one. */
  dropAll(): void;
  /** A beaten enemy is sunk (or taken): experience, standing, errands, the replacement's delay. */
  sunkCheck(e: Enemy, boarded?: boolean): void;
  /** A prize was taken into the fleet instead of being sunk: the same bookkeeping without the sinking. */
  takePrize(e: Enemy): void;
  step(dt: number): void;
}

/** The enemies of a run: their spawning in squads, their orders, their fire, their sinking and the bookkeeping of a kill. */
export function createEnemyDirector(d: EnemyDeps): EnemyDirector {
  let enemies: Enemy[] = [];
  let counter = 0;
  let respawnIn = 0;
  let threat = 0;

  const spawn = (): void => {
    const next = spawnFor(d.spec(), d.ship(), enemies, counter, d.rng, enemyNationFor(d.st, counter));
    if (!next) return; // no room right now: the caller tries again after STAGGER
    enemies.push(next);
    counter++;
  };

  /** Experience, standing and errands for a ship of the enemy's flag beaten by the captain. */
  const award = (e: Enemy, boarded: boolean): void => {
    const events: GameEvent[] = [];
    awardXp(d.st, killXp(e, boarded), e.ship, events);
    for (const ev of events) d.emit(ev);
    recordKill(d.st, e.nation);
    questKill(d.st, e.nation);
    threat++;
    d.st.captain.kills++;
    respawnIn = RESPAWN;
  };

  const sunkCheck = (e: Enemy, boarded = false): void => {
    if (e.hp > 0 || e.sinking >= 0) return;
    e.sinking = 0;
    award(e, boarded);
    d.emit({ type: 'sunk', owner: 'enemy', x: e.ship.x, y: 0, z: e.ship.z, length: e.spec.length });
  };

  return {
    list: () => enemies,
    kills: () => threat,
    setKills: (n) => {
      threat = n;
    },
    reset(): void {
      enemies = [];
      counter = 0; // a fresh run starts with the closest match and the first nation again
      respawnIn = 0;
      threat = 0;
      spawn();
    },
    dropAll(): void {
      enemies = [];
      respawnIn = STAGGER;
    },
    sunkCheck,
    takePrize(e): void {
      e.gone = true;
      award(e, true);
    },
    step(dt): void {
      const ship = d.ship();
      for (const e of enemies) {
        if (e.sinking >= 0) {
          e.sinking += dt;
          e.ship.speed *= 1 - 0.5 * dt;
          continue;
        }
        // it fights whichever of the captain's ships is nearest
        let target: { x: number; z: number } = ship;
        let targetD = Math.hypot(ship.x - e.ship.x, ship.z - e.ship.z);
        for (const c of d.consorts()) {
          const dist = c.sinking < 0 ? Math.hypot(c.ship.x - e.ship.x, c.ship.z - e.ship.z) : Infinity;
          if (dist < targetD) {
            target = c.ship;
            targetD = dist;
          }
        }
        const ai = aiStep(e, target, d.wind(), enemies.filter((o) => o !== e && o.sinking < 0).map((o) => o.ship));
        d.advance(e, ai.controls, dt);
        sunkCheck(e);
        if (e.sinking >= 0) continue;
        if (lostTrack(e, Math.hypot(e.ship.x - ship.x, e.ship.z - ship.z), dt)) {
          // Out of sight for too long: the enemy gives up (or, damaged, got away).
          e.gone = true;
          d.emit({ type: 'escaped', owner: 'enemy', x: e.ship.x, y: 0, z: e.ship.z });
          respawnIn = RESPAWN;
          continue;
        }
        e.reload.port = Math.max(0, e.reload.port - dt);
        e.reload.starboard = Math.max(0, e.reload.starboard - dt);
        if (ai.fire && !d.sunk() && !d.docked()) {
          d.fire(e.ship, e.spec, ai.fire, () => e.sinking < 0 && !e.gone);
          e.reload[ai.fire] = COMBAT.enemyReload;
        }
      }
      enemies = enemies.filter((e) => !e.gone && e.sinking < CONFIG.sinkSeconds);
      if (!d.sunk() && respawnIn > 0) respawnIn -= dt;
      if (!d.sunk() && respawnIn <= 0 && enemies.filter((e) => e.sinking < 0).length < desiredEnemies(threat + 2 * d.st.fleet.length)) {
        spawn();
        respawnIn = STAGGER;
      }
    },
  };
}
