import { startLoop } from './core';
import type { ShipSpec } from './ships';
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

showGallery();

startLoop({
  update: (dt) => mode?.update(dt),
  render: () => mode?.render(),
});
