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

/** No game may be saved while a fight is on: an enemy afloat this close (m). */
export const SAVE_SAFE_RANGE = 700;

/** Why the run cannot be saved now (a Turkish message), or null: sunk, or an enemy close by. */
export function whyNoSave(view: GameView | null): string | null {
  if (!view) return 'Oyun henüz hazır değil.';
  if (view.sunk) return 'Gemin battı: kayıt alınamaz.';
  if (!view.docked && view.enemies.some((e) => e.sinking < 0 && !e.surrendered && e.distance < SAVE_SAFE_RANGE)) return 'Savaş sırasında kayıt alınamaz: düşman çok yakın.';
  return null;
}

export type { GameState, SaveStore };
