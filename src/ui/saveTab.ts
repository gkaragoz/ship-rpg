import type { SettingsHandlers } from './settings';

/** What the "Kayıt" tab of the settings menu can do in the game it is opened over. */
export interface SaveControls {
  /** One line about the saved game, e.g. when and with which ship; empty when there is none. */
  info(): string;
  /** Write the run now; returns the message to show. */
  save(): string;
  /** Replace the run with the saved one; returns a message when it did not work (the game restarts on success). */
  load(): string;
  canLoad(): boolean;
}

type Tab = NonNullable<SettingsHandlers['extraTabs']>[number];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The "Kayıt" tab: save the run, load it back. The game also saves itself in port and every minute at sea. */
export function saveTab(controls: SaveControls): Tab {
  return {
    id: 'save',
    label: 'Kayıt',
    build(body): { refresh(): void; dispose(): void } {
      const info = el('p', 'settings-note');
      const message = el('p', 'settings-note');
      const row = el('div', 'settings-inline');
      const save = el('button', undefined, 'Kaydet');
      const load = el('button', undefined, 'Yükle');
      save.type = 'button';
      load.type = 'button';
      save.addEventListener('click', () => {
        message.textContent = controls.save();
        refresh();
      });
      load.addEventListener('click', () => {
        message.textContent = controls.load();
      });
      row.append(save, load);
      body.append(info, row, message, el('p', 'settings-note', 'Oyun limana girince ve denizde her dakika kendini kaydeder.'));
      const refresh = (): void => {
        info.textContent = controls.info() || 'Kayıtlı oyun yok.';
        load.disabled = !controls.canLoad();
      };
      refresh();
      return { refresh, dispose: () => undefined };
    },
  };
}
