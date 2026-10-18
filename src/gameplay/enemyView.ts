import type { BallView, EnemyView, PortView, ShipView } from '../core';
import type { Port } from '../world';
import type { Ball } from './combat';
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
    heave: e.ship.body.heave,
    pitch: e.ship.body.pitch,
    waveRoll: e.ship.body.waveRoll,
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
    heave: ship.body.heave,
    pitch: ship.body.pitch,
    waveRoll: ship.body.waveRoll,
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

/** The closest port as the HUD sees it, from the player's ship. */
export function portView(n: { port: Port; distance: number }, from: PlayerShip, dockable: boolean): PortView {
  return {
    id: n.port.id,
    name: n.port.name,
    distance: n.distance,
    direction: Math.atan2(-(n.port.anchor.z - from.z), n.port.anchor.x - from.x),
    dockable,
  };
}

export const ballViews = (balls: readonly Ball[]): BallView[] => balls.map((b) => ({ id: b.id, owner: b.owner, x: b.x, y: b.y, z: b.z }));
