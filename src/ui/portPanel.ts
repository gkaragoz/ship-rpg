import type { CommandResult, GameView, PortCommand } from '../core';
import { getPort } from '../world';
import { el } from './dom';
import { createMarketTab, reasonText } from './portMarket';
import { createTavernTab } from './portTavern';
import { createYardTab } from './portYard';
import { createFleetTab } from './portFleet';
import { createQuestsTab } from './portQuests';
import './portPanel.css';

export interface PortPanel {
  update(view: GameView): void;
  dispose(): void;
}

const gold = (n: number): string => Math.round(n).toLocaleString('tr-TR');

/** Harbour screen shown while the ship is moored: tabs for the market, the shipyard and the tavern. */
export function createPortPanel(host: HTMLElement, onCommand: (cmd: PortCommand) => CommandResult): PortPanel {
  const root = el('section', 'port-panel');
  root.hidden = true;
  const title = el('h2');
  const blurb = el('p', 'port-blurb');
  const purse = el('div', 'port-purse');
  const status = el('div', 'port-status');
  let statusLeft = 0;
  const send = (cmd: PortCommand): void => {
    const r = onCommand(cmd);
    status.textContent = r.ok ? '' : reasonText(r);
    statusLeft = 2.5;
  };

  const market = createMarketTab(send);
  const tavern = createTavernTab(send);
  const yard = createYardTab(send);
  const fleet = createFleetTab(send);
  const quests = createQuestsTab(send);
  const tabs = [
    { id: 'market', label: 'Pazar', body: market },
    { id: 'yard', label: 'Tersane', body: yard },
    { id: 'fleet', label: 'Filo', body: fleet },
    { id: 'tavern', label: 'Taverna', body: tavern },
    { id: 'quests', label: 'Görevler', body: quests },
  ] as const;
  const bar = el('div', 'port-tabs');
  const body = el('div', 'port-body');
  const buttons = new Map<string, HTMLButtonElement>();
  let active: (typeof tabs)[number]['id'] = 'market';
  const show = (id: typeof active): void => {
    active = id;
    for (const [tid, b] of buttons) b.classList.toggle('on', tid === id);
    body.replaceChildren(tabs.find((t) => t.id === id)?.body.root ?? market.root);
  };
  for (const t of tabs) {
    const b = el('button', undefined, t.label);
    b.type = 'button';
    b.addEventListener('click', () => {
      status.textContent = '';
      show(t.id);
    });
    buttons.set(t.id, b);
    bar.append(b);
  }
  show('market');

  const leave = el('div', 'port-leave', 'Denize çıkmak için F tuşuna bas');
  root.append(title, blurb, purse, bar, body, status, leave);
  host.appendChild(root);

  let current: string | null = null;
  let lastTime = 0;
  return {
    update(view): void {
      const { docked } = view;
      if (docked !== current) {
        current = docked;
        const port = docked ? getPort(docked) : undefined;
        root.hidden = !port;
        if (port) {
          title.textContent = port.name;
          blurb.textContent = port.description;
          status.textContent = '';
        }
      }
      if (!current) return;
      purse.textContent = `Altın ${gold(view.captain.gold)} · Ambar ${view.cargo.used}/${view.cargo.capacity}`;
      statusLeft = Math.max(0, statusLeft - Math.max(0, view.time - lastTime));
      lastTime = view.time;
      if (statusLeft <= 0) status.textContent = '';
      if (active === 'market') market.update(view);
      else if (active === 'tavern') tavern.update(view);
      else if (active === 'fleet') fleet.update(view);
      else if (active === 'quests') quests.update(view);
      else yard.update(view);
    },
    dispose(): void {
      root.remove();
    },
  };
}
