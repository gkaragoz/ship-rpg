import { HOUR_PRESETS, WEATHER_PRESETS, formatHour, type Weather, type WeatherOverrides } from '../world';
import type { SettingsHandlers } from './settings';

/** What the "Hava & Zaman" tab can change in the world it is opened over (the sailing game or the gallery). */
export interface WorldControls {
  hour(): number;
  setHour(hour: number): void;
  /** The weather as it is now, whoever set it. */
  weather(): Weather;
  /** Take over parts of the weather; a field set to `undefined` is the game's again, `null` gives everything back. */
  setWeather(change: WeatherOverrides | null): void;
}

type Tab = NonNullable<SettingsHandlers['extraTabs']>[number];

const QUICK_HOURS: readonly (readonly [label: string, hour: number])[] = [
  ['Şafak', HOUR_PRESETS.dawn],
  ['Sabah', HOUR_PRESETS.morning],
  ['Öğle', HOUR_PRESETS.noon],
  ['Gün batımı', HOUR_PRESETS.dusk],
  ['Gece', HOUR_PRESETS.night],
];

const DEG = 180 / Math.PI;
/** Compass bearing (clockwise from north) of a world heading angle, as the HUD shows it. */
const bearing = (angle: number): number => ((((Math.PI / 2 - angle) * DEG) % 360) + 360) % 360;
const fromBearing = (deg: number): number => Math.PI / 2 - deg / DEG;
const percent = (v: number): string => `${Math.round(v * 100)} %`;

interface Field {
  group: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** The slider value for this weather; null when the sky decides (cloud and haze have no number of their own). */
  get(w: Weather): number | null;
  format(v: number): string;
  /** The override that sets this field to a value, and the one that gives it back. */
  set(v: number): WeatherOverrides;
  clear(): WeatherOverrides;
}

const tune = (key: 'amp' | 'length' | 'chop' | 'speed', label: string, min: number, max: number, step: number): Field => ({
  group: 'Dalgalar', label, min, max, step,
  get: (w) => w.tuning[key],
  format: (v) => `× ${v.toFixed(2)}`,
  set: (v) => ({ tuning: { [key]: v } }),
  clear: () => ({ tuning: { [key]: undefined } as never }),
});

/** Every slider of the simulator. */
const FIELDS: readonly Field[] = [
  { group: 'Rüzgâr', label: 'Hız', min: 0, max: 30, step: 0.5, get: (w) => w.windSpeed, format: (v) => `${v.toFixed(1)} m/s`, set: (v) => ({ windSpeed: v }), clear: () => ({ windSpeed: undefined }) },
  { group: 'Rüzgâr', label: 'Yön (nereden)', min: 0, max: 359, step: 1, get: (w) => bearing(w.windFrom), format: (v) => `${Math.round(v)}°`, set: (v) => ({ windFrom: fromBearing(v) }), clear: () => ({ windFrom: undefined }) },
  { group: 'Deniz', label: 'Deniz durumu', min: 0, max: 1, step: 0.01, get: (w) => w.seaState, format: percent, set: (v) => ({ seaState: v }), clear: () => ({ seaState: undefined }) },
  tune('amp', 'Dalga yüksekliği', 0.2, 3, 0.05),
  tune('length', 'Dalga boyu', 0.5, 2.5, 0.05),
  tune('chop', 'Dalga keskinliği', 0, 2, 0.05),
  tune('speed', 'Dalga hızı', 0, 2, 0.05),
  { group: 'Atmosfer', label: 'Bulut', min: 0, max: 1, step: 0.01, get: (w) => w.cloud, format: percent, set: (v) => ({ cloud: v }), clear: () => ({ cloud: undefined }) },
  { group: 'Atmosfer', label: 'Sis', min: 0, max: 1, step: 0.01, get: (w) => w.fog, format: percent, set: (v) => ({ fog: v }), clear: () => ({ fog: undefined }) },
  { group: 'Atmosfer', label: 'Yağmur', min: 0, max: 1, step: 0.01, get: (w) => w.rain, format: percent, set: (v) => ({ rain: v }), clear: () => ({ rain: undefined }) },
  { group: 'Atmosfer', label: 'Şimşek', min: 0, max: 1, step: 0.01, get: (w) => w.lightning, format: percent, set: (v) => ({ lightning: v }), clear: () => ({ lightning: undefined }) },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buttons(label: string, items: readonly (readonly [string, () => void])[]): HTMLElement {
  const row = el('div', 'settings-row');
  row.append(el('label', 'settings-label', label));
  const box = el('div', 'settings-inline');
  for (const [text, run] of items) {
    const b = el('button', undefined, text);
    b.type = 'button';
    b.addEventListener('click', run);
    box.append(b);
  }
  row.append(box);
  return row;
}

/** The "Hava & Zaman" tab: the time of day, and the weather simulator (wind, sea, waves, sky, rain, lightning). */
export function weatherTab(controls: WorldControls): Tab {
  return {
    id: 'weather',
    label: 'Hava & Zaman',
    build(body): { refresh(): void; dispose(): void } {
      const touched = new Set<Field>();
      const syncs: (() => void)[] = [];

      const time = el('div', 'settings-row');
      time.append(el('label', 'settings-label', 'Saat'));
      const timeBox = el('div', 'settings-inline');
      const hourSlider = el('input', 'settings-input');
      hourSlider.type = 'range';
      hourSlider.min = '0';
      hourSlider.max = '24';
      hourSlider.step = '0.05';
      const hourOut = el('span', 'settings-value');
      hourSlider.addEventListener('input', () => {
        controls.setHour(Number(hourSlider.value) % 24);
        hourOut.textContent = formatHour(Number(hourSlider.value));
      });
      timeBox.append(hourSlider, hourOut);
      time.append(timeBox);
      body.append(time, buttons('Hızlı seç', QUICK_HOURS.map(([label, hour]) => [label, () => { controls.setHour(hour); refresh(); }] as const)));

      body.append(
        buttons('Hazır hava', [
          ...Object.entries(WEATHER_PRESETS).map(([name, o]) => [name, () => { touched.clear(); controls.setWeather(null); controls.setWeather(o); markAll(o); refresh(); }] as const),
          ['Otomatik', () => { touched.clear(); controls.setWeather(null); refresh(); }] as const,
        ]),
      );

      let group = '';
      for (const field of FIELDS) {
        if (field.group !== group) {
          group = field.group;
          body.append(el('h4', 'settings-group', group));
        }
        const row = el('div', 'settings-row settings-weather');
        const label = el('label', 'settings-label', field.label);
        const slider = el('input', 'settings-input');
        slider.type = 'range';
        slider.min = String(field.min);
        slider.max = String(field.max);
        slider.step = String(field.step);
        const out = el('span', 'settings-value');
        const auto = el('button', 'settings-auto', 'Oto');
        auto.type = 'button';
        auto.title = 'Oyunun kendi değerine dön';
        slider.addEventListener('input', () => {
          touched.add(field);
          controls.setWeather(field.set(Number(slider.value)));
          out.textContent = field.format(Number(slider.value));
          row.classList.add('manual');
        });
        auto.addEventListener('click', () => {
          touched.delete(field);
          controls.setWeather(field.clear());
          refresh();
        });
        row.append(label, slider, out, auto);
        body.append(row);
        syncs.push(() => {
          const v = field.get(controls.weather());
          slider.value = String(v ?? (field.min + field.max) / 2);
          out.textContent = v === null ? 'oto' : field.format(v);
          row.classList.toggle('manual', touched.has(field));
        });
      }

      // A weather preset sets some fields: mark them as the player's.
      const markAll = (o: WeatherOverrides): void => {
        for (const f of FIELDS) if (Object.keys(f.set(f.min)).some((k) => k in o)) touched.add(f);
      };
      const refresh = (): void => {
        hourSlider.value = String(controls.hour());
        hourOut.textContent = formatHour(controls.hour());
        for (const s of syncs) s();
      };
      refresh();
      return { refresh, dispose: () => body.replaceChildren() };
    },
  };
}
