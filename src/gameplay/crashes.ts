import type { GameEvent, OtherShipView } from '../core';
import { getShipSpec, type ShipSpec } from '../ships';
import { COLLISION, collideAll, type Hull } from './collision';
import type { Enemy } from './enemy';
import { PATROL_SPEED } from './npcShips';
import type { PlayerShip } from './sailing';



export interface CrashResult {
  events: GameEvent[];
  /** Hull points the player ship lost, and each enemy's by index into the list passed in. */
  playerLost: number;
  enemyLost: number[];
  /** Take the lost hull points off the player and off each enemy that lost some. */
  apply(onPlayer: (lost: number) => void, onEnemy: (enemy: Enemy, lost: number) => void): void;
}

/**
 * Let the ships that share the sea run into each other: the player (unless moored or sunk), the enemies afloat and
 * the patrols. Moves and turns the ships, applies the leaks, and reports the damage and the `collision` events.
 */
export function stepCrashes(
  player: { ship: PlayerShip; spec: ShipSpec; maxHp: number; active: boolean },
  enemies: readonly Enemy[],
  patrols: readonly OtherShipView[],
  /** Told how far a crash pushed and turned each patrol (by its id), so it can sail back onto its rail. */
  nudge?: (id: number, dx: number, dz: number, dyaw: number) => void,
): CrashResult {
  const hulls: Hull[] = [];
  const who: ('player' | 'enemy' | 'patrol')[] = [];
  const enemyAt: number[] = [];
  const patrolAt: { index: number; id: number; x: number; z: number; heading: number }[] = [];
  if (player.active) {
    hulls.push({ ship: player.ship, spec: player.spec, maxHp: player.maxHp });
    who.push('player');
    enemyAt.push(-1);
  }
  enemies.forEach((e, i) => {
    if (e.sinking >= 0) return;
    hulls.push({ ship: e.ship, spec: e.spec, maxHp: e.maxHp });
    who.push('enemy');
    enemyAt.push(i);
  });
  for (const p of patrols) {
    const spec = getShipSpec(p.specId);
    if (!spec) continue;
    // A patrol is a hull like any other (it takes no damage): a crash shoves it, in proportion to how light it is.
    hulls.push({ ship: { x: p.x, z: p.z, heading: p.heading, speed: PATROL_SPEED }, spec, maxHp: 0, group: 'patrol' });
    who.push('patrol');
    enemyAt.push(-1);
    patrolAt.push({ index: hulls.length - 1, id: p.id, x: p.x, z: p.z, heading: p.heading });
  }
  const result: CrashResult = {
    events: [],
    playerLost: 0,
    enemyLost: enemies.map(() => 0),
    apply(onPlayer, onEnemy): void {
      if (this.playerLost > 0) onPlayer(this.playerLost);
      enemies.forEach((e, i) => this.enemyLost[i]! > 0 && onEnemy(e, this.enemyLost[i]!));
    },
  };
  if (hulls.length < 2) return result;
  const impacts = collideAll(hulls);
  for (const p of patrolAt) {
    const ship = hulls[p.index]!.ship;
    if (ship.x !== p.x || ship.z !== p.z || ship.heading !== p.heading) nudge?.(p.id, ship.x - p.x, ship.z - p.z, ship.heading - p.heading);
  }
  for (const hit of impacts) {
    const owner = who[hit.a] === 'player' || who[hit.b] === 'player' ? 'player' : 'enemy';
    if (hit.speed < COLLISION.scrape && hit.lostA + hit.lostB <= 0) continue; // a touch or a scrape: the hulls are pushed apart, but nobody hears or sees a crash
    result.events.push({ type: 'collision', owner, x: hit.x, y: 0, z: hit.z, nx: hit.nx, nz: hit.nz, speed: hit.speed, amount: hit.lostA + hit.lostB });
    for (const [index, lost] of [[hit.a, hit.lostA], [hit.b, hit.lostB]] as const) {
      if (who[index] === 'player') result.playerLost += lost;
      else if (who[index] === 'enemy') result.enemyLost[enemyAt[index]!]! += lost;
    }
  }
  return result;
}
