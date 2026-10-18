import type { CrewView } from '../core';
import { getDeck, getShipSpec } from '../ships';
import { createCrew, crewCountFor, type CrewSim } from './crew';
import { crewLayout } from './crewLayout';

/** Beyond this many metres from the player a ship's sailors are not simulated (nobody could see them). */
export const CREW_RANGE = 220;
/** A crew that has not been looked at for this many steps stops being simulated; for this many it is forgotten. */
const ACTIVE_STEPS = 30;
const FORGET_STEPS = 60 * 40;

interface Entry {
  sim: CrewSim;
  /** Steps since the view last asked for it. */
  unseen: number;
  /** Reload seen at the last look, to notice a shot. */
  reload: { port: number; starboard: number };
}

/** What a ship's crew needs to know about the ship, from the game's own numbers. */
export interface CrewShip {
  specId: string;
  rudder: number;
  sailTarget: number;
  reload?: { port: number; starboard: number };
  /** Seconds a broadside takes to reload (for how long the gunners load). */
  reloadSeconds?: number;
}

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * The sailors of the ships around the player: enemies and patrols. A crew exists only for a ship with a walkable GLB
 * deck, is created when the ship first comes within `CREW_RANGE`, and is stepped only while somebody keeps looking at it.
 * Purely visual, like the player's own crew.
 */
export function createShipCrews(): { update(dt: number): void; view(key: string, ship: CrewShip, distance: number): CrewView[] | undefined } {
  const crews = new Map<string, Entry>();
  return {
    update(dt): void {
      for (const [key, e] of crews) {
        if (e.unseen < ACTIVE_STEPS) e.sim.update(dt);
        if (++e.unseen > FORGET_STEPS) crews.delete(key);
      }
    },
    view(key, ship, distance): CrewView[] | undefined {
      if (distance > CREW_RANGE) return undefined;
      let e = crews.get(key);
      if (!e) {
        const deck = getDeck(ship.specId);
        const spec = getShipSpec(ship.specId);
        if (!deck || !spec) return undefined;
        e = { sim: createCrew(deck, crewCountFor(spec.length), hash(key), crewLayout(spec, deck)), unseen: 0, reload: { port: 0, starboard: 0 } };
        crews.set(key, e);
      }
      e.unseen = 0;
      e.sim.helm(ship.rudder);
      e.sim.sails(ship.sailTarget);
      if (ship.reload) {
        for (const side of ['port', 'starboard'] as const) {
          if (ship.reload[side] > e.reload[side] + 0.5) e.sim.fire(side, ship.reloadSeconds ?? 6);
          e.reload[side] = ship.reload[side];
        }
      }
      return e.sim.view();
    },
  };
}
