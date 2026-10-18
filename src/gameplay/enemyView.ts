import { angleDiff } from '../core';
import type { ApparentWindView, BallView, EnemyView, PortView, ShipView, WindView } from '../core';
import { apparentWind, type Port } from '../world';
import type { Ball } from './combat';
import type { ShipSpec } from '../ships';
import { aimZone, cannonsPerSide, targetInZone } from './combat';
import { arcFor } from './gunnery';
import type { Enemy } from './enemy';
import { SAILING, maxSpeed, type PlayerShip } from './sailing';

/** The wind a ship feels, as the views carry it. */
export const apparentView = (wind: WindView, heading: number, speed: number): ApparentWindView => {
  const felt = apparentWind(wind, heading, speed);
  return { angle: angleDiff(felt.from, heading), speed: felt.speed };
};

/** What render and UI may know about an enemy, seen from the player's ship. */
export function enemyView(e: Enemy, from: PlayerShip, wind: WindView): EnemyView {
  return {
    id: e.id,
    apparent: apparentView(wind, e.ship.heading, e.ship.speed),
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
  state: { hp: number; maxHp: number; reloadSeconds: number; reload: { port: number; starboard: number }; elevation: number; air: { x: number; z: number }; wind: WindView; gust: number; armed: boolean },
  afloat: readonly Enemy[],
): ShipView {
  const zone = aimZone(spec, ship.speed, state.elevation);
  const armed = state.armed && cannonsPerSide(spec) > 0; // the arcs are only drawn for a ship that can fire
  return {
    specId: spec.id,
    name: spec.name,
    reloadSeconds: state.reloadSeconds,
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
    elevation: state.elevation,
    apparent: apparentView(state.wind, ship.heading, ship.speed),
    gust: state.gust,
    arc: armed ? { port: arcFor(spec, ship, 'port', state.elevation, state.air), starboard: arcFor(spec, ship, 'starboard', state.elevation, state.air) } : { port: [], starboard: [] },
    inRange: {
      port: afloat.some((e) => targetInZone(zone, ship, 'port', e.ship, e.spec.length)),
      starboard: afloat.some((e) => targetInZone(zone, ship, 'starboard', e.ship, e.spec.length)),
    },
    reload: { port: state.reload.port / state.reloadSeconds, starboard: state.reload.starboard / state.reloadSeconds },
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
