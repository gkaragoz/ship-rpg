import { PORTS, START_REPUTATION, getPort } from '../world';
import type { ShipSpec } from '../ships';
import type { Quest } from './quests';
import type { SeaState } from './seaState';

/**
 * Everything about a run that must survive a ship swap or a save: plain data, no functions or Maps,
 * so it can go through `JSON` unchanged. Transient things (enemies, balls, reload timers, patrols) are
 * not part of it: after a load the first enemy is spawned afresh, away from the player.
 */
/** A ship of the captain's fleet besides the flagship (`GameState.ship`). */
export interface FleetEntry {
  specId: string;
  hp: number;
  rigging: number;
  /** Sailors aboard, 0 ... its `stats.crew`. */
  crew: number;
}

/** Most ships sailing beside the flagship. */
export const MAX_CONSORTS = 3;

export interface GameState {
  ship: { specId: string; hp: number; rigging: number; flooding: number; fire: number };
  captain: { gold: number; xp: number; kills: number };
  /** Sailors aboard, 0 … the ship's `stats.crew`. */
  crew: number;
  /** Goods in the hold: good id → units. */
  hold: Record<string, number>;
  pose: { x: number; z: number; heading: number; dockedAt: string | null };
  discovered: { islands: string[]; ports: string[] };
  /** Price pressure per port and good (`p`, stamped with the game time `t` it was last set). */
  market: Record<string, Record<string, { p: number; t: number }>>;
  /** The captain's standing with each nation, -100 (hated) ... 100 (a hero): see `reputation.ts`. */
  reputation: Record<string, number>;
  /** The errands the captain carries, and the ids of those finished or given up (so they are not offered again today). */
  quests: Quest[];
  questLog: string[];
  /** The consorts: bought at a yard or taken as prizes, they sail with the flagship and fight for it. */
  fleet: FleetEntry[];
  /** Game second the fleet's upkeep was last paid (at the last port). */
  upkeepAt: number;
  /** The enemies afloat and the balls in the air when the game was saved at sea (absent when it was saved moored). */
  sea?: SeaState;
  /** Game seconds: the clock and the weather are pure functions of it. */
  time: number;
}

export const START_PORT = 'douwesen';
/** Start this far off the anchorage, facing open water. */
export const START_OFFSET = 70;
/** Gold a new captain begins with. */
export const START_GOLD = 2000;

/** Where a run starts: just off the start port, bow to open water. */
export function startPose(): GameState['pose'] {
  const start = getPort(START_PORT) ?? PORTS[0];
  if (!start) throw new Error('no ports defined');
  return {
    x: start.anchor.x + Math.cos(start.outward) * START_OFFSET,
    z: start.anchor.z + Math.sin(start.outward) * START_OFFSET,
    heading: -start.outward, // forward (cos ψ, -sin ψ) along the outward direction
    dockedAt: null,
  };
}

/** A new run with this ship: full hull and crew, an empty hold, a little gold. */
export function newGameState(spec: ShipSpec): GameState {
  return {
    ship: { specId: spec.id, hp: spec.stats.hp, rigging: 1, flooding: 0, fire: 0 },
    captain: { gold: START_GOLD, xp: 0, kills: 0 },
    crew: spec.stats.crew,
    hold: {},
    pose: startPose(),
    discovered: { islands: [], ports: [] },
    market: {},
    reputation: { ...START_REPUTATION },
    quests: [],
    questLog: [],
    fleet: [],
    upkeepAt: 0,
    time: 0,
  };
}

/** Units of hold the goods take. */
export const holdUsed = (hold: Record<string, number>): number => Object.values(hold).reduce((n, q) => n + q, 0);

/** A deep copy that shares nothing with the original. */
export const cloneState = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;
