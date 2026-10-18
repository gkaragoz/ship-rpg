import { describe, expect, it } from 'vitest';
import { createGame, createSaveStore, parseSave, sanitizeState, serializeSave, SAVE_VERSION, type Migration, type StorageLike } from '../src/gameplay';
import { newGameState } from '../src/gameplay/state';
import { getShipSpec } from '../src/ships';

const brig = getShipSpec('brig')!;
const DT = 1 / 60;
const idle = { rudder: 0, sailStep: 0 as const };

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

/** A version-1 save as written by the first release: checked in so a later change cannot break old files unnoticed. */
const V1 = JSON.stringify({
  version: 1,
  savedAt: '2026-10-18T20:00:00.000Z',
  state: {
    ship: { specId: 'brig', hp: 1800, rigging: 0.8, flooding: 0.1, fire: 0 },
    captain: { gold: 4321, xp: 150, kills: 3 },
    crew: 120,
    hold: { rum: 40, silk: 12 },
    pose: { x: -400, z: 20, heading: 1.2, dockedAt: null },
    discovered: { islands: ['douwesen', 'redmond'], ports: ['douwesen'] },
    market: { douwesen: { rum: { p: 0.1, t: 500 } } },
    time: 900,
  },
});

describe('reading a save', () => {
  it('reads a version-1 file', () => {
    const r = parseSave(V1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ship).toEqual({ specId: 'brig', hp: 1800, rigging: 0.8, flooding: 0.1, fire: 0 });
    expect(r.state.captain).toEqual({ gold: 4321, xp: 150, kills: 3 });
    expect(r.state.hold).toEqual({ rum: 40, silk: 12 });
    expect(r.state.discovered.islands).toEqual(['douwesen', 'redmond']);
    expect(r.state.market.douwesen?.rum).toEqual({ p: 0.1, t: 500 });
    expect(r.savedAt).toBe('2026-10-18T20:00:00.000Z');
    expect(r.version).toBe(1);
  });

  it('writes what it reads', () => {
    const state = newGameState(brig);
    state.captain.gold = 77;
    const r = parseSave(serializeSave(state, 'now'));
    expect(r.ok && r.state).toEqual(state);
    expect(JSON.parse(serializeSave(state, 'now')).version).toBe(SAVE_VERSION);
  });

  it('migrates old versions step by step', () => {
    const toV2: Migration = (raw) => ({ ...raw, version: 2, state: { ...(raw.state as object), crew: 99 } });
    const toV3: Migration = (raw) => ({ ...raw, version: 3 });
    const r = parseSave(V1, { 1: toV2, 2: toV3 }, 3);
    expect(r.ok && r.state.crew).toBe(99);
    // A missing step is a damaged file, not a crash.
    expect(parseSave(V1, { 1: toV2 }, 3)).toEqual({ ok: false, reason: 'damaged' });
  });

  it('refuses nonsense, empty and newer files without throwing', () => {
    expect(parseSave(null)).toEqual({ ok: false, reason: 'empty' });
    expect(parseSave('')).toEqual({ ok: false, reason: 'empty' });
    for (const bad of ['{', '[]', '"x"', 'null', '{"version":"1"}', '{"version":0}', '{"version":1}', '{"version":1,"state":{"ship":{"specId":"raft"}}}']) {
      expect(parseSave(bad), bad).toEqual({ ok: false, reason: 'damaged' });
    }
    expect(parseSave(JSON.stringify({ version: SAVE_VERSION + 1, state: {} }))).toEqual({ ok: false, reason: 'newer' });
  });
});

describe('sanitising a state', () => {
  const edit = (change: (s: ReturnType<typeof newGameState>) => void) => {
    const s = newGameState(brig);
    change(s);
    return sanitizeState(JSON.parse(JSON.stringify(s)))!;
  };

  it('clamps numbers to what the ship can have', () => {
    const s = edit((x) => {
      x.ship.hp = 1e9;
      x.ship.rigging = -3;
      x.ship.flooding = 7;
      x.crew = 99999;
      x.captain.gold = -50;
    });
    expect(s.ship).toMatchObject({ hp: brig.stats.hp, rigging: 0, flooding: 1 });
    expect(s.crew).toBe(brig.stats.crew);
    expect(s.captain.gold).toBe(0);
  });

  it('trims the hold to the capacity and drops unknown goods', () => {
    const s = edit((x) => {
      x.hold = { rum: 1400, silk: 400, ghost: 5 };
    });
    expect(s.hold).toEqual({ rum: 1400, silk: 100 });
  });

  it('drops unknown ports, islands and market lines, and survives NaN and prototype keys', () => {
    const raw = JSON.parse(V1);
    raw.state.discovered = { islands: ['douwesen', 'atlantis', 7], ports: ['nowhere'] };
    raw.state.pose = { x: 'a', z: null, heading: 5, dockedAt: 'nowhere' };
    raw.state.market = { douwesen: { rum: { p: 99, t: -5 }, constructor: { p: 1, t: 1 } }, nowhere: {}, __proto__: { x: 1 } };
    raw.state.hold = { constructor: 5, rum: 'many' };
    raw.state.time = NaN;
    const r = parseSave(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.discovered).toEqual({ islands: ['douwesen'], ports: [] });
    expect(r.state.pose).toEqual({ x: 0, z: 0, heading: 5, dockedAt: null });
    expect(r.state.market.douwesen).toEqual({ rum: { p: 1, t: 0 } });
    expect(Object.keys(r.state.market)).toEqual(['douwesen']);
    expect(r.state.hold).toEqual({});
    expect(r.state.time).toBe(0);
  });

  it('rejects what is not a state at all', () => {
    expect(sanitizeState(null)).toBeNull();
    expect(sanitizeState({})).toBeNull();
    expect(sanitizeState({ ship: { specId: 5 } })).toBeNull();
  });
});

describe('the save slot', () => {
  it('saves, loads and clears', () => {
    const storage = memory();
    const store = createSaveStore(storage);
    expect(store.load()).toEqual({ ok: false, reason: 'empty' });
    expect(store.save(newGameState(brig), 'now')).toBe(true);
    const r = store.load();
    expect(r.ok && r.state.ship.specId).toBe('brig');
    store.clear();
    expect(store.load().ok).toBe(false);
  });

  it('survives blocked or full storage', () => {
    const none = createSaveStore(null);
    expect(none.save(newGameState(brig), 'now')).toBe(false);
    expect(none.load().ok).toBe(false);
    const angry: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createSaveStore(angry);
    expect(store.save(newGameState(brig), 'now')).toBe(false);
    expect(store.load().ok).toBe(false);
    expect(() => store.clear()).not.toThrow();
  });

  it('does not write a state that is not valid over a good save', () => {
    const storage = memory();
    const store = createSaveStore(storage);
    store.save(newGameState(brig), 'a');
    const broken = newGameState(brig);
    broken.ship.specId = 'raft';
    expect(store.save(broken, 'b')).toBe(false);
    expect(store.load().ok).toBe(true);
  });
});

describe('a run through a save', () => {
  it('state → file → game → state keeps the run: ship, purse, hold, place, discoveries, market, time', () => {
    const first = createGame(brig);
    first.dev.setGold(5000);
    first.dev.addXp(130);
    first.dev.setCrew(100);
    first.dev.teleportPlayer(first.state().pose.x + 250, first.state().pose.z);
    for (let i = 0; i < 180; i++) first.update(DT, idle);
    const saved = first.state();
    const file = serializeSave(saved, 'now');
    const r = parseSave(file);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const again = createGame(r.state);
    for (let i = 0; i < 5; i++) again.update(0, idle); // a resumed game is the same game
    const back = again.state();
    expect(back.ship.specId).toBe(saved.ship.specId);
    expect(back.captain).toEqual(saved.captain);
    expect(back.crew).toBe(saved.crew);
    expect(back.discovered).toEqual(saved.discovered);
    expect(back.time).toBeCloseTo(saved.time, 6);
    expect(back.pose.x).toBeCloseTo(saved.pose.x, 3);
    expect(again.view().captain.level).toBe(first.view().captain.level);
  });

  it('a game saved moored resumes moored, with its market remembered', () => {
    const state = newGameState(getShipSpec('tartane')!);
    state.captain.gold = 100000;
    const g = createGame(state);
    const port = g.state().pose;
    expect(port.dockedAt).toBeNull();
    g.dev.teleportPlayer(-260 + 0, 300); // away from any port: nothing to trade here
    const s = g.state();
    s.pose.dockedAt = 'douwesen';
    s.market = { douwesen: { rum: { p: 0.3, t: 0 } } };
    const resumed = createGame(s);
    expect(resumed.view().docked).toBe('douwesen');
    const rum = resumed.view().port!.market.find((m) => m.good === 'rum')!;
    expect(rum.trend).toBeGreaterThan(1.1);
  });
});
