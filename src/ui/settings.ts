import type { SettingsStore } from '../settings';
import './settings.css';
import { CONTROLS, TABS, type Control, type TabId } from './settingsControls';

export interface SettingsUI {
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
  dispose(): void;
}

export interface SettingsHandlers {
  /** Shown as a button in the menu when given (the sailing mode's way back to the gallery). */
  onExit?: { label: string; run(): void };
  onOpenChange?(open: boolean): void;
  /** Tabs that are not a plain list of controls (the weather simulator): filled by the caller. */
  extraTabs?: readonly { id: string; label: string; build(body: HTMLElement): { refresh(): void; dispose(): void } }[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A row of the menu: its label, the control, and a `sync` that shows the store's current value. */
function buildRow(control: Control, store: SettingsStore): { row: HTMLElement; sync(): void } {
  const row = el('div', 'settings-row');
  const label = el('label', 'settings-label', control.label);
  if (control.hint) label.title = control.hint;
  row.append(label);
  const settings = (): ReturnType<SettingsStore['get']> => store.get();
  if (control.kind === 'select') {
    const select = el('select', 'settings-input');
    for (const [value, text] of control.options) {
      const option = el('option', undefined, text);
      option.value = value;
      select.append(option);
    }
    select.addEventListener('change', () => {
      if (control.choose) control.choose(store, select.value);
      else store.patch(control.set(select.value));
    });
    row.append(select);
    return { row, sync: () => (select.value = control.get(settings())) };
  }
  if (control.kind === 'range') {
    const input = el('input', 'settings-input');
    input.type = 'range';
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
    const value = el('span', 'settings-value');
    input.addEventListener('input', () => store.patch(control.set(Number(input.value))));
    row.append(input, value);
    return {
      row,
      sync(): void {
        const v = control.get(settings());
        input.value = String(v);
        value.textContent = control.format(v);
      },
    };
  }
  const box = el('input', 'settings-input');
  box.type = 'checkbox';
  box.addEventListener('change', () => store.patch(control.set(box.checked)));
  row.append(box);
  return { row, sync: () => (box.checked = control.get(settings())) };
}

/** The settings menu: a gear button, and a panel with the tabs, opened by the button or `toggle()`. */
export function createSettingsUI(host: HTMLElement, store: SettingsStore, handlers: SettingsHandlers = {}): SettingsUI {
  const gear = el('button', 'settings-gear', '⚙');
  gear.type = 'button';
  gear.title = 'Ayarlar (Esc)';
  const overlay = el('div', 'settings');
  overlay.hidden = true;
  const panel = el('section', 'settings-panel');
  const header = el('div', 'settings-header');
  const close = el('button', 'settings-close', '×');
  close.type = 'button';
  header.append(el('h2', undefined, 'Ayarlar'), close);
  const tabs = el('div', 'settings-tabs');
  const body = el('div', 'settings-body');
  const footer = el('div', 'settings-footer');
  const reset = el('button', undefined, 'Varsayılana dön');
  reset.type = 'button';
  footer.append(reset);
  if (handlers.onExit) {
    const exit = el('button', 'settings-exit', handlers.onExit.label);
    exit.type = 'button';
    const run = handlers.onExit.run;
    exit.addEventListener('click', () => run());
    footer.append(exit);
  }
  panel.append(header, tabs, body, footer);
  overlay.append(panel);
  host.append(gear, overlay);

  const syncs: (() => void)[] = [];
  const pages = new Map<string, HTMLElement>();
  const buttons = new Map<string, HTMLButtonElement>();
  const disposers: (() => void)[] = [];
  const ids: { id: string; label: string }[] = [...TABS];
  for (const tab of TABS) {
    const page = el('div', 'settings-page');
    for (const control of CONTROLS.filter((c) => c.tab === tab.id)) {
      const { row, sync } = buildRow(control, store);
      page.append(row);
      syncs.push(sync);
    }
    pages.set(tab.id, page);
  }
  for (const extra of handlers.extraTabs ?? []) {
    const page = el('div', 'settings-page');
    const built = extra.build(page);
    syncs.push(built.refresh);
    disposers.push(built.dispose);
    pages.set(extra.id, page);
    ids.push({ id: extra.id, label: extra.label });
  }
  let active: TabId | string = ids[0]?.id ?? 'graphics';
  const show = (id: string): void => {
    active = id;
    body.replaceChildren(pages.get(id) ?? el('div'));
    for (const [tabId, button] of buttons) button.classList.toggle('on', tabId === id);
  };
  for (const tab of ids) {
    const button = el('button', undefined, tab.label);
    button.type = 'button';
    button.addEventListener('click', () => show(tab.id));
    buttons.set(tab.id, button);
    tabs.append(button);
  }
  show(active);

  const refresh = (): void => {
    for (const sync of syncs) sync();
  };
  refresh();
  const unsubscribe = store.subscribe(refresh);

  let opened = false;
  const set = (value: boolean): void => {
    if (opened === value) return;
    opened = value;
    overlay.hidden = !value;
    if (value) refresh();
    handlers.onOpenChange?.(value);
  };
  gear.addEventListener('click', () => set(!opened));
  close.addEventListener('click', () => set(false));
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) set(false); // a click on the backdrop closes the menu
  });
  reset.addEventListener('click', () => store.reset());

  return {
    open: () => set(true),
    close: () => set(false),
    toggle: () => set(!opened),
    get isOpen(): boolean {
      return opened;
    },
    dispose(): void {
      unsubscribe();
      for (const d of disposers) d();
      gear.remove();
      overlay.remove();
    },
  };
}
