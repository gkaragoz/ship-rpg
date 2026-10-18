import { createSaveStore, type GameState, type LoadResult, type SaveStore } from '../gameplay';
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

export type { GameState, SaveStore };
