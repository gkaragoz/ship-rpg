import type { DeepPartial, Settings, SettingsStore } from '../settings';

export type TabId = 'graphics' | 'audio' | 'game' | 'debug';

export const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'graphics', label: 'Grafik' },
  { id: 'audio', label: 'Ses' },
  { id: 'game', label: 'Oynanış' },
  { id: 'debug', label: 'Hata ayıklama' },
];

interface Base {
  tab: TabId;
  label: string;
  hint?: string;
}

export interface SelectControl extends Base {
  kind: 'select';
  options: readonly (readonly [value: string, label: string])[];
  get(s: Settings): string;
  set(value: string): DeepPartial<Settings>;
  /** Instead of `set`, for a choice that is more than one patch (the presets). */
  choose?(store: SettingsStore, value: string): void;
}

export interface RangeControl extends Base {
  kind: 'range';
  min: number;
  max: number;
  step: number;
  format(value: number): string;
  get(s: Settings): number;
  set(value: number): DeepPartial<Settings>;
}

export interface ToggleControl extends Base {
  kind: 'toggle';
  get(s: Settings): boolean;
  set(value: boolean): DeepPartial<Settings>;
}

export type Control = SelectControl | RangeControl | ToggleControl;

const percent = (v: number): string => `${Math.round(v * 100)} %`;

/**
 * Every control of the settings menu. The menu is built from this list, so a new setting is one entry here
 * (and the code that reads it) and nothing else.
 */
export const CONTROLS: readonly Control[] = [
  {
    tab: 'graphics', kind: 'select', label: 'Ön ayar', hint: 'Bir değeri elle değiştirirsen "Özel" olur.',
    options: [['low', 'Düşük'], ['medium', 'Orta'], ['high', 'Yüksek'], ['custom', 'Özel']],
    get: (s) => s.graphics.preset,
    set: () => ({}),
    choose(store, v): void {
      if (v === 'low' || v === 'medium' || v === 'high') store.preset(v);
    },
  },
  {
    tab: 'graphics', kind: 'select', label: 'Kenar yumuşatma', hint: 'MSAA en temizi ama daha pahalı; FXAA ucuzdur.',
    options: [['off', 'Kapalı'], ['fxaa', 'FXAA'], ['msaa2', 'MSAA 2x'], ['msaa4', 'MSAA 4x'], ['msaa8', 'MSAA 8x']],
    get: (s) => s.graphics.antialias,
    set: (v) => ({ graphics: { antialias: v as Settings['graphics']['antialias'] } }),
  },
  {
    tab: 'graphics', kind: 'range', label: 'Çözünürlük ölçeği', hint: 'İç çözünürlük; 100 % altı hızlandırır, üstü keskinleştirir.',
    min: 0.5, max: 2, step: 0.05, format: percent,
    get: (s) => s.graphics.renderScale,
    set: (v) => ({ graphics: { renderScale: v } }),
  },
  {
    tab: 'graphics', kind: 'toggle', label: 'Parlama (bloom)', get: (s) => s.graphics.bloom, set: (v) => ({ graphics: { bloom: v } }),
  },
  {
    tab: 'graphics', kind: 'select', label: 'Ton eşleme', hint: 'Parlak gökyüzü ve güneşi ekran aralığına sığdırır.',
    options: [['none', 'Kapalı'], ['aces', 'ACES'], ['agx', 'AgX']],
    get: (s) => s.graphics.toneMapping,
    set: (v) => ({ graphics: { toneMapping: v as Settings['graphics']['toneMapping'] } }),
  },
  {
    tab: 'graphics', kind: 'range', label: 'Pozlama', min: 0.5, max: 2, step: 0.05, format: (v) => v.toFixed(2),
    get: (s) => s.graphics.exposure,
    set: (v) => ({ graphics: { exposure: v } }),
  },
  {
    tab: 'graphics', kind: 'select', label: 'Gölgeler', hint: 'Gemilerin ve adaların gölgesi; denizde gemi gölgesi de buna bağlı.',
    options: [['off', 'Kapalı'], ['low', 'Düşük'], ['medium', 'Orta'], ['high', 'Yüksek']],
    get: (s) => s.graphics.shadows,
    set: (v) => ({ graphics: { shadows: v as Settings['graphics']['shadows'] } }),
  },
  {
    tab: 'graphics', kind: 'range', label: 'Gölge mesafesi', min: 0.5, max: 1.5, step: 0.05, format: percent,
    get: (s) => s.graphics.shadowDistance,
    set: (v) => ({ graphics: { shadowDistance: v } }),
  },
  {
    tab: 'graphics', kind: 'range', label: 'Görüş mesafesi', hint: 'Sis ve ufuk ne kadar uzakta.', min: 0.5, max: 1.5, step: 0.05, format: percent,
    get: (s) => s.graphics.viewDistance,
    set: (v) => ({ graphics: { viewDistance: v } }),
  },
  {
    tab: 'graphics', kind: 'select', label: 'Doku kalitesi', hint: 'Doku filtreleme (anizotropik) ile denizin detay ve derinlik dokularının boyutu.',
    options: [['low', 'Düşük'], ['medium', 'Orta'], ['high', 'Yüksek']],
    get: (s) => s.graphics.textures,
    set: (v) => ({ graphics: { textures: v as Settings['graphics']['textures'] } }),
  },
  {
    tab: 'graphics', kind: 'range', label: 'Parçacık yoğunluğu', hint: 'Duman, sıçrama, kıymık ve alev parçacıkları.', min: 0.25, max: 1, step: 0.05, format: percent,
    get: (s) => s.graphics.particles,
    set: (v) => ({ graphics: { particles: v } }),
  },
  {
    tab: 'graphics', kind: 'select', label: 'Su kalitesi', hint: 'Deniz ağı çözünürlüğü ve gemi izi haritası.',
    options: [['low', 'Düşük'], ['medium', 'Orta'], ['high', 'Yüksek']],
    get: (s) => s.graphics.water,
    set: (v) => ({ graphics: { water: v as Settings['graphics']['water'] } }),
  },
  {
    tab: 'graphics', kind: 'toggle', label: 'Otomatik kalite', hint: 'Kare hızı düşük kalırsa su kalitesini kendiliğinden düşürür.',
    get: (s) => s.graphics.autoQuality,
    set: (v) => ({ graphics: { autoQuality: v } }),
  },
  {
    tab: 'graphics', kind: 'select', label: 'FPS sınırı',
    options: [['0', 'Sınırsız'], ['30', '30'], ['60', '60'], ['90', '90'], ['144', '144']],
    get: (s) => String(s.graphics.fpsLimit),
    set: (v) => ({ graphics: { fpsLimit: Number(v) as Settings['graphics']['fpsLimit'] } }),
  },
  {
    tab: 'audio', kind: 'toggle', label: 'Sessiz',
    get: (s) => s.audio.muted,
    set: (v) => ({ audio: { muted: v } }),
  },
  { tab: 'audio', kind: 'range', label: 'Ana ses', min: 0, max: 1, step: 0.05, format: percent, get: (s) => s.audio.master, set: (v) => ({ audio: { master: v } }) },
  { tab: 'audio', kind: 'range', label: 'Efektler', hint: 'Toplar, isabetler, sıçramalar.', min: 0, max: 1, step: 0.05, format: percent, get: (s) => s.audio.sfx, set: (v) => ({ audio: { sfx: v } }) },
  { tab: 'audio', kind: 'range', label: 'Ortam', hint: 'Rüzgâr, deniz, gövde, yangın.', min: 0, max: 1, step: 0.05, format: percent, get: (s) => s.audio.ambience, set: (v) => ({ audio: { ambience: v } }) },
  { tab: 'game', kind: 'range', label: 'Arayüz boyutu', min: 0.7, max: 1.5, step: 0.05, format: percent, get: (s) => s.game.hudScale, set: (v) => ({ game: { hudScale: v } }) },
  { tab: 'game', kind: 'toggle', label: 'İpucu çubuğu', get: (s) => s.game.showHints, set: (v) => ({ game: { showHints: v } }) },
  { tab: 'game', kind: 'range', label: 'Kamera hassasiyeti', min: 0.4, max: 2, step: 0.05, format: percent, get: (s) => s.game.cameraSensitivity, set: (v) => ({ game: { cameraSensitivity: v } }) },
];
