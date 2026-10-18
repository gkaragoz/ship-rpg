import { SHIP_SPECS, createShip, type Ship, type ShipSpec } from '../ships';
import { createGalleryView } from '../render';
import { getSettings } from '../settings';
import { createGalleryUI, createSettingsUI, type GalleryItem, type GalleryUI } from '../ui';
import { applyGameSettings } from './gameSettings';
import type { Mode } from './mode';

const toItem = (s: ShipSpec): GalleryItem => ({
  id: s.id,
  name: s.name,
  group: `Sınıf ${s.stats.rank}`,
  description: s.description,
  stats: [
    { label: 'Boy', value: `${s.length} m` },
    { label: 'Direk', value: String(s.masts.length) },
    { label: 'Can (HP)', value: String(s.stats.hp) },
    { label: 'Hız', value: String(s.stats.speed) },
    { label: 'Manevra', value: String(s.stats.turn) },
    { label: 'Ambar', value: String(s.stats.hold) },
    { label: 'Mürettebat', value: String(s.stats.crew) },
    { label: 'Top', value: s.stats.cannons ? `${s.stats.cannons} × ${s.stats.shot} lb` : '—' },
  ],
});

// Class 7 (smallest) to class 1 (largest); stable within a class.
const ORDERED = [...SHIP_SPECS].sort((a, b) => b.stats.rank - a.stats.rank);

/** Ship gallery: browse the 16 ships in 3D; "sail" hands the chosen ship to the caller. */
export function startGalleryMode(host: HTMLElement, selectedId: string | undefined, onSail: (spec: ShipSpec) => void): Mode {
  // The panel is created after the view; the view reads its insets lazily.
  const panel: { ui?: GalleryUI } = {};
  const store = getSettings();
  const view = createGalleryView(host, () => panel.ui?.insets() ?? { left: 0, top: 0, bottom: 0 }, store.get().graphics);

  let current: Ship | null = null;
  const ui = createGalleryUI(host, ORDERED.map(toItem), {
    onSelect(id) {
      const spec = ORDERED.find((s) => s.id === id);
      if (!spec) return;
      view.setSubject(null);
      current?.dispose();
      current = createShip(spec);
      view.setSubject(current.root);
    },
    onAutoRotate: (on) => view.setAutoRotate(on),
    onSail(id) {
      const spec = ORDERED.find((s) => s.id === id);
      if (spec) onSail(spec);
    },
  });
  panel.ui = ui;
  const settingsUI = createSettingsUI(host, store);
  const applySettings = (): void => {
    view.setGraphics(store.get().graphics);
    view.setCameraSensitivity(store.get().game.cameraSensitivity);
    applyGameSettings(store.get().game);
  };
  applySettings();
  const unsubscribe = store.subscribe(applySettings);
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') settingsUI.toggle();
  };
  window.addEventListener('keydown', onKey);

  const first = ORDERED.find((s) => s.id === selectedId) ?? ORDERED[0];
  if (first) ui.select(first.id);

  return {
    update: (dt) => view.update(dt),
    render: () => view.render(),
    dispose(): void {
      window.removeEventListener('keydown', onKey);
      unsubscribe();
      settingsUI.dispose();
      ui.dispose();
      view.setSubject(null);
      current?.dispose();
      view.dispose();
    },
  };
}
