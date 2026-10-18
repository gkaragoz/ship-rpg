import { getShipSpec } from '../ships';
import { GOODS, ISLANDS, PORTS, TRADE, WORLD_BOUNDS, getPort } from '../world';
import { MAX_CONSORTS, holdUsed, type FleetEntry, type GameState } from './state';

/** The bit of `Storage` the save needs (injectable for tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The saved file: a version, when it was written (told by the caller: game logic never reads the wall clock) and the
 * run's state. When `GameState` gains fields, bump `SAVE_VERSION` and add the step from the old version to `MIGRATIONS`;
 * `sanitizeState` fills in anything missing, so additive fields need a migration only when old values must be converted.
 */
export const SAVE_VERSION = 2;
export interface SaveData {
  version: number;
  savedAt: string;
  state: GameState;
}

/** Steps from version `n` to `n + 1`, applied in order to the raw JSON. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // 1 -> 2: the fleet. An old run has no consorts and has never paid upkeep.
  1: (raw) => {
    const state = isRecord(raw.state) ? raw.state : {};
    return { ...raw, version: 2, state: { ...state, fleet: [], upkeepAt: typeof state.time === 'number' ? state.time : 0 } };
  },
};

export const SAVE_KEY = 'ship-rpg.save';

/** How far beyond the islands a saved position may lie (m). */
const FAR = 3000;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const ids = (v: unknown, known: readonly string[]): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && known.includes(x)))] : [];

/**
 * Turn whatever was in the file into a valid state, or null when it cannot be one (no known ship). Every number is
 * clamped, unknown goods, ports and islands are dropped, the hold is trimmed to the ship's capacity and the crew to
 * its company, so a hand-edited or damaged save cannot break the game.
 */
export function sanitizeState(raw: unknown): GameState | null {
  if (!isRecord(raw) || !isRecord(raw.ship)) return null;
  const spec = typeof raw.ship.specId === 'string' ? getShipSpec(raw.ship.specId) : undefined;
  if (!spec) return null;
  const captain = isRecord(raw.captain) ? raw.captain : {};
  const pose = isRecord(raw.pose) ? raw.pose : {};
  const seen = isRecord(raw.discovered) ? raw.discovered : {};

  const hold: Record<string, number> = {};
  let space = spec.stats.hold;
  if (isRecord(raw.hold)) {
    for (const g of GOODS) {
      const qty = Math.floor(num(raw.hold[g.id], 0, 0, space));
      if (qty > 0) {
        hold[g.id] = qty;
        space -= qty;
      }
    }
  }

  const market: GameState['market'] = {};
  if (isRecord(raw.market)) {
    for (const port of PORTS) {
      const lines = raw.market[port.id];
      if (!isRecord(lines)) continue;
      for (const g of GOODS) {
        const m = lines[g.id];
        if (isRecord(m) && typeof m.p === 'number' && typeof m.t === 'number' && Number.isFinite(m.p) && Number.isFinite(m.t)) {
          (market[port.id] ??= {})[g.id] = { p: num(m.p, 0, TRADE.pressureMin, TRADE.pressureMax), t: Math.max(0, m.t) };
        }
      }
    }
  }

  const fleet: FleetEntry[] = [];
  if (Array.isArray(raw.fleet)) {
    for (const f of raw.fleet) {
      if (fleet.length >= MAX_CONSORTS) break;
      const fs = isRecord(f) && typeof f.specId === 'string' ? getShipSpec(f.specId) : undefined;
      if (!isRecord(f) || !fs) continue;
      fleet.push({ specId: fs.id, hp: num(f.hp, fs.stats.hp, 1, fs.stats.hp), rigging: num(f.rigging, 1, 0, 1), crew: Math.floor(num(f.crew, fs.stats.crew, 0, fs.stats.crew)) });
    }
  }

  const docked = typeof pose.dockedAt === 'string' && getPort(pose.dockedAt) ? pose.dockedAt : null;
  return {
    ship: {
      specId: spec.id,
      hp: num(raw.ship.hp, spec.stats.hp, 1, spec.stats.hp),
      rigging: num(raw.ship.rigging, 1, 0, 1),
      flooding: num(raw.ship.flooding, 0, 0, 1),
      fire: num(raw.ship.fire, 0, 0, 1),
    },
    captain: {
      gold: Math.floor(num(captain.gold, 0, 0, 1e12)),
      xp: Math.floor(num(captain.xp, 0, 0, 1e9)),
      kills: Math.floor(num(captain.kills, 0, 0, 1e9)),
    },
    crew: Math.floor(num(raw.crew, spec.stats.crew, 0, spec.stats.crew)),
    hold,
    // A hand-edited position stays within sight of the archipelago.
    pose: {
      x: num(pose.x, 0, WORLD_BOUNDS.minX - FAR, WORLD_BOUNDS.maxX + FAR),
      z: num(pose.z, 0, WORLD_BOUNDS.minZ - FAR, WORLD_BOUNDS.maxZ + FAR),
      heading: num(pose.heading, 0, -1e4, 1e4),
      dockedAt: docked,
    },
    discovered: { islands: ids(seen.islands, ISLANDS.map((i) => i.id)), ports: ids(seen.ports, PORTS.map((p) => p.id)) },
    market,
    fleet,
    upkeepAt: num(raw.upkeepAt, 0, 0, 1e9),
    time: num(raw.time, 0, 0, 1e9),
  };
}

export type LoadResult = { ok: true; state: GameState; savedAt: string; version: number } | { ok: false; reason: 'empty' | 'damaged' | 'newer' };

/** Read a saved file: migrate it up to the current version, then sanitise the state. */
export function parseSave(text: string | null, migrations: Readonly<Record<number, Migration>> = MIGRATIONS, current = SAVE_VERSION): LoadResult {
  if (!text) return { ok: false, reason: 'empty' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'damaged' };
  }
  if (!isRecord(raw) || typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) return { ok: false, reason: 'damaged' };
  if (raw.version > current) return { ok: false, reason: 'newer' }; // written by a later game: do not guess
  let data: Record<string, unknown> = raw;
  for (let v = raw.version; v < current; v++) {
    const step = migrations[v];
    if (!step) return { ok: false, reason: 'damaged' };
    try {
      const next: unknown = step(data);
      if (!isRecord(next)) return { ok: false, reason: 'damaged' };
      data = next;
    } catch {
      return { ok: false, reason: 'damaged' }; // a migration that cannot read the file: report it, do not lose the message
    }
  }
  const state = sanitizeState(data.state);
  if (!state) return { ok: false, reason: 'damaged' };
  const when = typeof data.savedAt === 'string' && data.savedAt.length <= 40 && Number.isFinite(Date.parse(data.savedAt)) ? data.savedAt : '';
  return { ok: true, state, savedAt: when, version: raw.version };
}

export const serializeSave = (state: GameState, savedAt: string): string => JSON.stringify({ version: SAVE_VERSION, savedAt, state } satisfies SaveData);

export interface SaveStore {
  /** The saved run, if there is a usable one. */
  load(): LoadResult;
  /** Write the run; false when storage is blocked or full. */
  save(state: GameState, savedAt: string): boolean;
  clear(): void;
}

/** One save slot in `storage` (null when the browser blocks it: nothing is ever saved or found). */
export function createSaveStore(storage: StorageLike | null, key = SAVE_KEY): SaveStore {
  return {
    load(): LoadResult {
      try {
        return parseSave(storage?.getItem(key) ?? null);
      } catch {
        return { ok: false, reason: 'empty' }; // storage refused to answer
      }
    },
    save(state, savedAt): boolean {
      if (!storage) return false;
      try {
        // A save from a later version of the game is not ours to overwrite.
        const existing = parseSave(storage.getItem(key));
        if (!existing.ok && existing.reason === 'newer') return false;
        // A state that is already in the hold bounds is what the game wrote; refuse to write nonsense over a good save.
        if (!sanitizeState(state) || holdUsed(state.hold) < 0) return false;
        storage.setItem(key, serializeSave(state, savedAt));
        return true;
      } catch {
        return false;
      }
    },
    clear(): void {
      try {
        storage?.removeItem(key);
      } catch {
        /* nothing to clear */
      }
    },
  };
}
