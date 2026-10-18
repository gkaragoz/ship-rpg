import type { Controls, GameView } from '../core';
import type { ShipSpec } from '../ships';
import { windAt } from '../world';
import { SAILING, createPlayerShip, maxSpeed, stepPlayerShip } from './sailing';

export interface Game {
  readonly spec: ShipSpec;
  update(dt: number, controls: Controls): void;
  view(): GameView;
}

/** Open-sea sailing sandbox: one player ship in a changing wind. */
export function createGame(spec: ShipSpec): Game {
  const ship = createPlayerShip();
  let time = 0;
  let wind = windAt(time);

  return {
    spec,
    update(dt, controls): void {
      time += dt;
      wind = windAt(time);
      stepPlayerShip(ship, spec, wind, controls, dt);
    },
    view(): GameView {
      return {
        time,
        wind,
        ship: {
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
        },
      };
    },
  };
}
