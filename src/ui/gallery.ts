import './gallery.css';

export interface GalleryItem {
  id: string;
  name: string;
  group: string;
  description: string;
  stats: readonly { label: string; value: string }[];
}

export interface GalleryHandlers {
  onSelect(id: string): void;
  onAutoRotate(on: boolean): void;
  /** The player chose to sail the selected ship. */
  onSail(id: string): void;
  /** A saved game to go on with: the button's text (what is saved) and what it does. */
  onContinue?: { label: string; run(): void };
}

export interface GalleryUI {
  select(id: string): void;
  /** Screen area (px) currently covered by panels, for framing the 3D view. */
  insets(): { left: number; top: number; bottom: number };
  dispose(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Ship list on the left, details card at the bottom. Arrow keys switch ships. */
export function createGalleryUI(host: HTMLElement, items: readonly GalleryItem[], handlers: GalleryHandlers): GalleryUI {
  const root = el('div', 'gallery');
  const list = el('nav', 'gallery-list');
  list.appendChild(el('h1', undefined, 'Gemi Galerisi'));
  const buttons = new Map<string, HTMLButtonElement>();

  let group = '';
  for (const item of items) {
    if (item.group !== group) {
      group = item.group;
      list.appendChild(el('h2', undefined, group));
    }
    const button = el('button', undefined, item.name);
    button.type = 'button';
    button.addEventListener('click', () => select(item.id));
    buttons.set(item.id, button);
    list.appendChild(button);
  }

  const card = el('section', 'gallery-card');
  const title = el('h3');
  const blurb = el('p');
  const stats = el('dl');
  const rotate = el('label', 'gallery-rotate');
  const checkbox = el('input');
  checkbox.type = 'checkbox';
  checkbox.checked = true;
  checkbox.addEventListener('change', () => handlers.onAutoRotate(checkbox.checked));
  rotate.append(checkbox, ' Otomatik döndür');
  const sail = el('button', 'gallery-sail', 'Yelken aç ▸');
  sail.type = 'button';
  sail.addEventListener('click', () => current && handlers.onSail(current));
  const actions = el('div', 'gallery-actions');
  if (handlers.onContinue) {
    const go = handlers.onContinue;
    const cont = el('button', 'gallery-sail', 'Devam et');
    cont.type = 'button';
    cont.title = go.label;
    cont.addEventListener('click', () => go.run());
    const saved = el('span', 'gallery-saved', go.label);
    actions.append(rotate, saved, cont, sail);
  } else actions.append(rotate, sail);
  card.append(title, blurb, stats, actions);
  root.append(list, card);
  host.appendChild(root);

  let current = '';
  function select(id: string): void {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    current = id;
    buttons.forEach((b, key) => b.classList.toggle('active', key === id));
    title.textContent = item.name;
    blurb.textContent = item.description;
    stats.replaceChildren(
      ...item.stats.flatMap((s) => [el('dt', undefined, s.label), el('dd', undefined, s.value)]),
    );
    handlers.onSelect(id);
  }

  const onKey = (e: KeyboardEvent): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const index = items.findIndex((i) => i.id === current);
    const next = items[(index + step + items.length) % items.length];
    if (next) select(next.id);
  };
  window.addEventListener('keydown', onKey);

  const insets = (): { left: number; top: number; bottom: number } => {
    const l = list.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const strip = l.width > l.height * 2;
    return {
      left: strip ? 0 : l.right,
      top: strip ? l.bottom : 0,
      bottom: Math.max(host.clientHeight - c.top, 0),
    };
  };

  return {
    select,
    insets,
    dispose(): void {
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
