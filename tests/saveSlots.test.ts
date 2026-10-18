import { describe, expect, it } from 'vitest';
import type { GameView } from '../src/core';
import { SAVE_KEY, SLOTS, createSaveStore, type StorageLike } from '../src/gameplay';
import { newGameState } from '../src/gameplay/state';
import { SAVE_SAFE_RANGE, whyNoSave } from '../src/app/saves';
import { getShipSpec } from '../src/ships';

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};
const state = (gold: number, ship = 'brig') => {
  const s = newGameState(getShipSpec(ship)!);
  s.captain.gold = gold;
  return s;
};

describe('save slots', () => {
  it('has the autosave and five slots of your own, each its own key (the autosave keeps the old key)', () => {
    expect([...SLOTS]).toEqual(['auto', '1', '2', '3', '4', '5']);
    const mem = memory();
    const store = createSaveStore(mem);
    for (const slot of SLOTS) expect(store.save(state(100), '2026-01-01T00:00:00Z', slot)).toBe(true);
    expect([...mem.data.keys()].sort()).toEqual([SAVE_KEY, `${SAVE_KEY}.1`, `${SAVE_KEY}.2`, `${SAVE_KEY}.3`, `${SAVE_KEY}.4`, `${SAVE_KEY}.5`].sort());
  });

  it('keeps slots apart: saving, loading and clearing one leaves the others alone', () => {
    const store = createSaveStore(memory());
    store.save(state(1), '2026-01-01T00:00:00Z');
    store.save(state(2), '2026-01-02T00:00:00Z', '1');
    store.save(state(3), '2026-01-03T00:00:00Z', '2');
    const gold = (slot: (typeof SLOTS)[number]): number | null => {
      const r = store.load(slot);
      return r.ok ? r.state.captain.gold : null;
    };
    expect([gold('auto'), gold('1'), gold('2'), gold('3')]).toEqual([1, 2, 3, null]);
    store.clear('1');
    expect([gold('auto'), gold('1'), gold('2')]).toEqual([1, null, 3]);
    store.save(state(9), '2026-02-01T00:00:00Z', '2'); // overwrite
    expect(gold('2')).toBe(9);
  });

  it('lists every slot with its result', () => {
    const store = createSaveStore(memory());
    store.save(state(5), '2026-01-01T00:00:00Z', '3');
    const all = store.slots();
    expect(all.map((s) => s.slot)).toEqual([...SLOTS]);
    expect(all.filter((s) => s.result.ok).map((s) => s.slot)).toEqual(['3']);
    expect(all.find((s) => s.slot === 'auto')?.result).toEqual({ ok: false, reason: 'empty' });
  });

  it('continues the newest save of any slot', () => {
    const store = createSaveStore(memory());
    expect(store.latest()).toBeNull();
    store.save(state(1), '2026-03-01T10:00:00Z');
    store.save(state(2), '2026-03-02T10:00:00Z', '4');
    store.save(state(3), '2026-02-01T10:00:00Z', '1');
    const latest = store.latest();
    expect(latest?.slot).toBe('4');
    expect(latest?.result.state.captain.gold).toBe(2);
    store.save(state(4), '2026-03-05T10:00:00Z'); // the autosave is the newest now
    expect(store.latest()?.slot).toBe('auto');
  });

  it('refuses to overwrite a slot written by a later game, and survives a blocked store', () => {
    const mem = memory();
    const store = createSaveStore(mem);
    mem.data.set(`${SAVE_KEY}.2`, JSON.stringify({ version: 99, savedAt: 'x', state: {} }));
    expect(store.save(state(1), '2026-01-01T00:00:00Z', '2')).toBe(false);
    expect(store.load('2')).toEqual({ ok: false, reason: 'newer' });
    expect(store.save(state(1), '2026-01-01T00:00:00Z', '3')).toBe(true); // other slots are fine
    const none = createSaveStore(null);
    expect(none.save(state(1), 'x', '1')).toBe(false);
    expect(none.slots().every((s) => !s.result.ok)).toBe(true);
    expect(none.latest()).toBeNull();
  });
});

describe('no saving in a fight', () => {
  const view = (over: Partial<GameView>): GameView => ({ sunk: false, docked: null, enemies: [], ...over }) as unknown as GameView;
  const foe = (distance: number, extra: Record<string, unknown> = {}) => ({ distance, sinking: -1, surrendered: false, ...extra });

  it('allows it at sea with no enemy near, and in port whatever is outside', () => {
    expect(whyNoSave(view({}))).toBeNull();
    expect(whyNoSave(view({ enemies: [foe(SAVE_SAFE_RANGE + 1)] as unknown as GameView['enemies'] }))).toBeNull();
    expect(whyNoSave(view({ docked: 'douwesen', enemies: [foe(50)] as unknown as GameView['enemies'] }))).toBeNull();
  });

  it('refuses with an enemy near, a sunk ship, or before the game is ready; a wreck, a runner far off and a prize do not count', () => {
    expect(whyNoSave(view({ enemies: [foe(SAVE_SAFE_RANGE - 1)] as unknown as GameView['enemies'] }))).toMatch(/Savaş/);
    expect(whyNoSave(view({ sunk: true }))).toMatch(/battı/);
    expect(whyNoSave(null)).toMatch(/hazır/);
    expect(whyNoSave(view({ enemies: [foe(100, { sinking: 4 })] as unknown as GameView['enemies'] }))).toBeNull();
    expect(whyNoSave(view({ enemies: [foe(100, { surrendered: true })] as unknown as GameView['enemies'] }))).toBeNull();
  });
});
