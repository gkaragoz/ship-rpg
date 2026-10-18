import type { EnemyView, ShipView } from '../core';
import type { ShipSpec } from '../ships';
import { COMBAT, aimZone, cannonsPerSide, targetInZone } from './combat';
import type { Enemy } from './enemy';
import { SAILING, maxSpeed, type PlayerShip } from './sailing';

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

/** The player's own ship as render and UI see it; `afloat` are the enemies that count for the in-range glow. */
export function playerView(
  ship: PlayerShip,
  spec: ShipSpec,
  state: { hp: number; maxHp: number; reload: { port: number; starboard: number } },
  afloat: readonly Enemy[],
): ShipView {
  const zone = aimZone(spec, ship.speed);
  return {
    x: ship.x,
    z: ship.z,
    heading: ship.heading,
    speed: ship.speed,
    knots: ship.speed / SAILING.speedScale,
    maxKnots: maxSpeed(spec) / SAILING.speedScale,
    rudder: ship.rudder,
    sailLevel: ship.sailLevel,
    sailTarget: ship.sailTarget,
    efficiency: ship.efficiency,
    roll: ship.roll,
    hp: state.hp,
    maxHp: state.maxHp,
    rigging: ship.rigging,
    flooding: ship.flooding,
    fire: ship.fire,
    guns: cannonsPerSide(spec),
    aim: zone,
    inRange: {
      port: afloat.some((e) => targetInZone(zone, ship, 'port', e.ship, e.spec.length)),
      starboard: afloat.some((e) => targetInZone(zone, ship, 'starboard', e.ship, e.spec.length)),
    },
    reload: { port: state.reload.port / COMBAT.playerReload, starboard: state.reload.starboard / COMBAT.playerReload },
  };
}
