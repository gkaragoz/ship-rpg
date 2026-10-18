import type { SettingsHandlers } from './settings';

/** One row of the "Kayıt" tab: a save slot. */
export interface SaveSlotInfo {
  slot: string;
  label: string;
  /** One line about what is in it (ship, gold, when); empty when the slot is empty. */
  info: string;
  canLoad: boolean;
  /** The autosave cannot be written by hand. */
  canSave: boolean;
}

/** What the "Kayıt" tab of the settings menu can do in the game it is opened over. */
export interface SaveControls {
  slots(): SaveSlotInfo[];
  /** Write the run to a slot now; returns the message to show. */
  save(slot: string): string;
  /** Replace the run with the one in a slot; returns a message when it did not work (the game restarts on success). */
  load(slot: string): string;
}

type Tab = NonNullable<SettingsHandlers['extraTabs']>[number];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The "Kayıt" tab: the autosave and five slots of your own, each to save into or load back. */
export function saveTab(controls: SaveControls): Tab {
  return {
    id: 'save',
    label: 'Kayıt',
    build(body): { refresh(): void; dispose(): void } {
      const list = el('div', 'save-slots');
      const message = el('p', 'settings-note');
      body.append(list, message, el('p', 'settings-note', 'Oyun limana girince ve (savaş dışında) denizde her dakika Otomatik kayda yazar. Savaş sırasında kayıt alınamaz.'));
      const refresh = (): void => {
        list.replaceChildren();
        for (const s of controls.slots()) {
          const row = el('div', 'save-slot');
          row.append(el('strong', undefined, s.label), el('span', 'save-info', s.info || 'boş'));
          const save = el('button', undefined, 'Kaydet');
          save.type = 'button';
          save.disabled = !s.canSave;
          save.addEventListener('click', () => {
            message.textContent = controls.save(s.slot);
            refresh();
          });
          const load = el('button', undefined, 'Yükle');
          load.type = 'button';
          load.disabled = !s.canLoad;
          load.addEventListener('click', () => {
            message.textContent = controls.load(s.slot);
          });
          row.append(save, load);
          list.append(row);
        }
      };
      refresh();
      return { refresh, dispose: () => undefined };
    },
  };
}
