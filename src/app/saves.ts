import { createSaveStore, type GameState, type LoadResult, type SaveStore } from '../gameplay';
import type { GameView } from '../core';
import { getShipSpec } from '../ships';

/** The browser's save slot (a blocked `localStorage` just means nothing is saved). */
export function createGameSaves(): SaveStore {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return createSaveStore(storage);
}

/** One line about a save for the menus: ship, gold, level-ish facts, and when. */
export function describeSave(r: LoadResult): string {
  if (!r.ok) return r.reason === 'empty' ? '' : r.reason === 'newer' ? 'Kayıt daha yeni bir sürümden.' : 'Kayıt bozuk.';
  return `${getShipSpec(r.state.ship.specId)?.name ?? '?'} · ${Math.round(r.state.captain.gold).toLocaleString('tr-TR')} altın · ${r.savedAt ? new Date(r.savedAt).toLocaleString('tr-TR') : ''}`;
}

/** Why the run cannot be saved now (a Turkish message), or null: only a sunk ship cannot (a fight at sea is saved as it stands). */
export function whyNoSave(view: GameView | null): string | null {
  if (!view) return 'Oyun henüz hazır değil.';
  if (view.sunk) return 'Gemin battı: kayıt alınamaz.';
  return null;
}

export type { GameState, SaveStore };
