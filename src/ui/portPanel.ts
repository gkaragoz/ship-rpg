import type { GameView } from '../core';
import { getPort } from '../world';
import './portPanel.css';

export interface PortPanel {
  update(view: GameView): void;
  dispose(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Harbour screen shown while the ship is moored. Services arrive with the trade phase. */
export function createPortPanel(host: HTMLElement): PortPanel {
  const root = el('section', 'port-panel');
  root.hidden = true;
  const title = el('h2');
  const blurb = el('p');
  const services = el('ul');
  for (const s of ['Pazar', 'Tersane', 'Taverna']) {
    const item = el('li', undefined, s);
    item.append(el('span', undefined, ' · yakında'));
    services.append(item);
  }
  const leave = el('div', 'port-leave', 'Denize çıkmak için E tuşuna bas');
  root.append(title, blurb, services, leave);
  host.appendChild(root);

  let current: string | null = null;
  return {
    update({ docked }): void {
      if (docked === current) return;
      current = docked;
      const port = docked ? getPort(docked) : undefined;
      root.hidden = !port;
      if (port) {
        title.textContent = port.name;
        blurb.textContent = port.description;
      }
    },
    dispose(): void {
      root.remove();
    },
  };
}
