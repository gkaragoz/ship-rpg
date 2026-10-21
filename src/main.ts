import { createProfiler, startLoop } from './core';
import { getSettings } from './settings';
import { loadCrewAssets, loadWorldAssets } from './render';
import { loadShipAssets, requestShipAsset, getShipSpec, type ShipSpec } from './ships';
import type { GameState } from './gameplay';
import { createGameSaves, describeSave } from './app/saves';
import { startGalleryMode } from './app/galleryMode';
import { startSailingMode } from './app/sailingMode';
import type { Mode } from './app/mode';
import { createDebugOverlay, createLoadingBar } from './ui';

const host = document.getElementById('app');
if (!host) throw new Error('#app not found');
const root: HTMLElement = host;

let mode: Mode | undefined;
const saves = createGameSaves();
const loadingBar = createLoadingBar();

function showGallery(selectedId?: string): void {
  mode?.dispose();
  const saved = saves.latest(); // "Devam et" continues the newest save of any slot
  mode = startGalleryMode(root, selectedId, showSailing, saved ? { label: describeSave(saved.result), run: () => showSailing(saved.result.state) } : undefined);
}

/** Start sailing: a new run with a ship, or a saved run's state. */
let starting = false;
function showSailing(init: ShipSpec | GameState): void {
  if (starting) return; // a second press while the model loads
  starting = true;
  const spec = 'ship' in init ? getShipSpec(init.ship.specId) : init;
  if (!spec) {
    showGallery();
    return;
  }
  // The crew walks the model's deck, which the game reads once at the start: have the model loaded first.
  loadingBar.show(document.body);
  void requestShipAsset(spec.id).finally(() => {
    starting = false;
    loadingBar.hide();
    mode?.dispose();
    mode = startSailingMode(root, init, () => showGallery(spec.id), saves, showSailing);
  });
}

// Blender models load first; if one fails the game falls back to procedural ships / no crew.
loadingBar.show(document.body);
void Promise.all([loadShipAssets(), loadCrewAssets(), loadWorldAssets()]).then(() => {
  loadingBar.hide();
  root.replaceChildren();
  showGallery();
  const settings = getSettings();
  // The frame profiler and its overlay (F3; Shift+F3 for the detail; also in the settings menu and with ?debug).
  const profiler = createProfiler();
  const overlay = createDebugOverlay(document.body);
  const applyDebug = (): void => {
    overlay.setVisible(settings.get().debug.overlay);
    overlay.setDetail(settings.get().debug.detail);
  };
  applyDebug();
  settings.subscribe(applyDebug);
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F3') return;
    e.preventDefault();
    if (e.repeat) return;
    const d = settings.get().debug;
    settings.patch({ debug: e.shiftKey ? { detail: d.detail === 'full' ? 'mini' : 'full' } : { overlay: !d.overlay } });
  });
  // In dev the store is on window, to try settings from the console: __settings.patch({ graphics: { antialias: 'fxaa' } }).
  if (import.meta.env.DEV) (window as unknown as { __settings?: typeof settings }).__settings = settings;
  let lastRender = 0;
  startLoop({
    update: (dt) => {
      profiler.begin('güncelleme');
      mode?.update(dt);
      profiler.end('güncelleme');
    },
    render: () => {
      // The frame limit skips drawing (the simulation keeps its fixed step).
      const limit = settings.get().graphics.fpsLimit;
      const now = performance.now();
      if (limit > 0 && now - lastRender < 1000 / limit - 1.5) return;
      lastRender = now;
      profiler.begin('çizim');
      mode?.render();
      profiler.end('çizim');
      profiler.frame(now);
      overlay.update(now, profiler, () => mode?.debugInfo?.() ?? []);
    },
  });
});
