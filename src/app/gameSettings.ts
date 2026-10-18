import type { GameSettings } from '../settings';

/** Show the interface settings on the page: the HUD size (`--hud-scale`) and whether the key hints are shown. */
export function applyGameSettings(game: GameSettings, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--hud-scale', String(game.hudScale));
  root.classList.toggle('no-hints', !game.showHints);
}
