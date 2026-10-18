import { SHIP_SPECS, createShip, type Ship, type ShipSpec } from '../ships';
import { createGalleryView } from '../render';
import { getSettings } from '../settings';
import { createGalleryUI, createSettingsUI, weatherTab, type GalleryItem, type GalleryUI } from '../ui';
import type { CrewAnim } from '../core';
import { renderLines } from './debugLines';
import { applyGameSettings } from './gameSettings';
import type { Mode } from './mode';

/** Where the `?pose=` sailors stand (ship-local x, z). */
const POSE_SPOTS = [{ x: -1.5, z: 0.5 }, { x: 0.6, z: -0.6 }, { x: 2, z: 0.4 }, { x: -0.5, z: -0.9 }];

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
export function startGalleryMode(host: HTMLElement, selectedId: string | undefined, onSail: (spec: ShipSpec) => void, onContinue?: { label: string; run(): void }): Mode {
  // The panel is created after the view; the view reads its insets lazily.
  const panel: { ui?: GalleryUI } = {};
  const store = getSettings();
  const view = createGalleryView(host, () => panel.ui?.insets() ?? { left: 0, top: 0, bottom: 0 }, store.get().graphics);

  // ?ensign=english|french|spanish|dutch|pirate|free shows that nation's flag on the gallery ship
  const ensign = new URLSearchParams(window.location.search).get('ensign') ?? 'free';
  let current: Ship | null = null;
  const ui = createGalleryUI(host, ORDERED.map(toItem), {
    onSelect(id) {
      const spec = ORDERED.find((s) => s.id === id);
      if (!spec) return;
      view.setSubject(null);
      current?.dispose();
      current = createShip(spec, { ensign });
      view.setSubject(current.root);
    },
    onAutoRotate: (on) => view.setAutoRotate(on),
    onSail(id) {
      const spec = ORDERED.find((s) => s.id === id);
      if (spec) onSail(spec);
    },
    onContinue,
  });
  panel.ui = ui;
  const settingsUI = createSettingsUI(host, store, { extraTabs: [weatherTab({ hour: () => view.hour(), setHour: (h) => view.setHour(h), weather: () => view.weather(), setWeather: (c) => view.setWeather(c) })] });
  const applySettings = (): void => {
    view.setGraphics(store.get().graphics);
    view.setCameraSensitivity(store.get().game.cameraSensitivity);
    view.setClock(store.get().game.dayMinutes, store.get().game.freezeTime);
    applyGameSettings(store.get().game);
  };
  applySettings();
  const unsubscribe = store.subscribe(applySettings);
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && !e.repeat && !(e.target instanceof HTMLSelectElement)) settingsUI.toggle();
  };
  window.addEventListener('keydown', onKey);

  const first = ORDERED.find((s) => s.id === selectedId) ?? ORDERED[0];
  if (first) ui.select(first.id);

  // ?sail=0…1 (and ?windrel=radians from the bow) holds the gallery ship's sails at a trim, to inspect furled cloth.
  const query = new URLSearchParams(window.location.search);
  const heldLevel = query.has('sail') ? Number(query.get('sail')) : undefined;
  const heldWind = Number(query.get('windrel') ?? 1.2);
  // ?pose=Helm|Haul|Climb|Aloft|Load|Fire|Fly|Swim|Drown puts a few sailors on the deck in that pose, to look at it
  const pose = query.get('pose') as CrewAnim | null;
  let poseClock = 0;

  return {
    debugInfo: () => renderLines(view.stats(), store.get().graphics),
    update: (dt) => {
      if (pose) {
        poseClock += dt;
        view.setCrew(POSE_SPOTS.map((spot, id) => ({ id, ...spot, y: 2.2, heading: 0, anim: pose, clock: poseClock, lean: Math.sin(poseClock), look: { variant: id % 6, skin: 0, shirt: id, pants: 0, hair: 0, hat: 0, hairStyle: 'short', hatStyle: 'none', beard: false } })));
      }
      if (heldLevel !== undefined && Number.isFinite(heldLevel) && current) current.setSailTrim(heldWind, heldLevel);
      view.update(dt);
    },
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
