import type { EnemyView } from '../core';
import type { Enemy } from './enemy';
import type { PlayerShip } from './sailing';

/** What render and UI may know about an enemy, seen from the player's ship. */
export function enemyView(e: Enemy, from: PlayerShip): EnemyView {
  return {
    id: e.id,
    specId: e.spec.id,
    name: e.spec.name,
    nation: e.nation,
    x: e.ship.x,
    z: e.ship.z,
    heading: e.ship.heading,
    speed: e.ship.speed,
    roll: e.ship.roll,
    sailLevel: e.ship.sailLevel,
    hp: e.hp,
    maxHp: e.maxHp,
    sinking: e.sinking,
    fleeing: e.fleeing,
    rigging: e.ship.rigging,
    flooding: e.ship.flooding,
    fire: e.ship.fire,
    distance: Math.hypot(e.ship.x - from.x, e.ship.z - from.z),
    direction: Math.atan2(-(e.ship.z - from.z), e.ship.x - from.x),
  };
}
