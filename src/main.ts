import { startLoop } from './core';
import { SHIP_SPECS, createShip, type Ship, type ShipSpec } from './ships';
import { createGalleryView } from './render';
import { createGalleryUI, type GalleryItem, type GalleryUI } from './ui';

const host = document.getElementById('app');
if (!host) throw new Error('#app not found');

// The panel is created after the view; the view reads its insets lazily.
const panel: { ui?: GalleryUI } = {};
const view = createGalleryView(host, () => panel.ui?.insets() ?? { left: 0, top: 0, bottom: 0 });

const GROUPS: Record<number, string> = { 7: 'Sınıf 7', 6: 'Sınıf 6', 5: 'Sınıf 5', 4: 'Sınıf 4', 3: 'Sınıf 3', 2: 'Sınıf 2', 1: 'Sınıf 1' };

const toItem = (s: ShipSpec): GalleryItem => ({
  id: s.id,
  name: s.name,
  group: GROUPS[s.stats.rank] ?? 'Diğer',
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
const ordered = [...SHIP_SPECS].sort((a, b) => b.stats.rank - a.stats.rank);

let current: Ship | null = null;
const ui = createGalleryUI(host, ordered.map(toItem), {
  onSelect(id) {
    const spec = ordered.find((s) => s.id === id);
    if (!spec) return;
    view.setSubject(null);
    current?.dispose();
    current = createShip(spec);
    view.setSubject(current.root);
  },
  onAutoRotate: (on) => view.setAutoRotate(on),
});

panel.ui = ui;
const first = ordered[0];
if (first) ui.select(first.id);

startLoop({
  update: (dt) => view.update(dt),
  render: () => view.render(),
});
