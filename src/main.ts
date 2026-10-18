import { startLoop } from './core';
import { getSettings } from './settings';
import { loadCrewAssets } from './render';
import { loadShipAssets, type ShipSpec } from './ships';
import { startGalleryMode } from './app/galleryMode';
import { startSailingMode } from './app/sailingMode';
import type { Mode } from './app/mode';

const host = document.getElementById('app');
if (!host) throw new Error('#app not found');
const root: HTMLElement = host;

let mode: Mode | undefined;

function showGallery(selectedId?: string): void {
  mode?.dispose();
  mode = startGalleryMode(root, selectedId, showSailing);
}

function showSailing(spec: ShipSpec): void {
  mode?.dispose();
  mode = startSailingMode(root, spec, () => showGallery(spec.id));
}

// Blender models load first; if one fails the game falls back to procedural ships / no crew.
root.textContent = 'Yükleniyor…';
void Promise.all([loadShipAssets(), loadCrewAssets()]).then(() => {
  root.replaceChildren();
  showGallery();
  const settings = getSettings();
  // In dev the store is on window, to try settings from the console: __settings.patch({ graphics: { antialias: 'fxaa' } }).
  if (import.meta.env.DEV) (window as unknown as { __settings?: typeof settings }).__settings = settings;
  let lastRender = 0;
  startLoop({
    update: (dt) => mode?.update(dt),
    render: () => {
      // The frame limit skips drawing (the simulation keeps its fixed step).
      const limit = settings.get().graphics.fpsLimit;
      const now = performance.now();
      if (limit > 0 && now - lastRender < 1000 / limit - 1.5) return;
      lastRender = now;
      mode?.render();
    },
  });
});
