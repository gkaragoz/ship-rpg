import { HOUR_PRESETS, formatHour } from '../world';
import type { SettingsHandlers } from './settings';

/** What the "Hava & Zaman" tab can change in the world it is opened over (the sailing game or the gallery). */
export interface WorldControls {
  hour(): number;
  setHour(hour: number): void;
}

type Tab = NonNullable<SettingsHandlers['extraTabs']>[number];

const QUICK: readonly (readonly [label: string, hour: number])[] = [
  ['Şafak', HOUR_PRESETS.dawn],
  ['Sabah', HOUR_PRESETS.morning],
  ['Öğle', HOUR_PRESETS.noon],
  ['Gün batımı', HOUR_PRESETS.dusk],
  ['Gece', HOUR_PRESETS.night],
];

function row(label: string): { row: HTMLElement; box: HTMLElement } {
  const node = document.createElement('div');
  node.className = 'settings-row';
  const l = document.createElement('label');
  l.className = 'settings-label';
  l.textContent = label;
  const box = document.createElement('div');
  box.className = 'settings-inline';
  node.append(l, box);
  return { row: node, box };
}

/** The "Hava & Zaman" tab: the time of day now (a slider and quick buttons); weather controls join it. */
export function weatherTab(controls: WorldControls): Tab {
  return {
    id: 'weather',
    label: 'Hava & Zaman',
    build(body): { refresh(): void; dispose(): void } {
      const time = row('Saat');
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '24';
      slider.step = '0.05';
      slider.className = 'settings-input';
      const readout = document.createElement('span');
      readout.className = 'settings-value';
      slider.addEventListener('input', () => {
        controls.setHour(Number(slider.value) % 24);
        readout.textContent = formatHour(Number(slider.value));
      });
      time.box.append(slider, readout);
      const quick = row('Hızlı seç');
      for (const [label, hour] of QUICK) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', () => {
          controls.setHour(hour);
          refresh();
        });
        quick.box.append(button);
      }
      body.append(time.row, quick.row);
      const refresh = (): void => {
        slider.value = String(controls.hour());
        readout.textContent = formatHour(controls.hour());
      };
      refresh();
      return { refresh, dispose: () => body.replaceChildren() };
    },
  };
}
