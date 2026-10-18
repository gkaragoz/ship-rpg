import type { GameView, PortCommand } from '../core';
import { el } from './dom';

/** The tavern tab: sign on sailors (they man the guns faster) or discharge them. */
export function createTavernTab(send: (cmd: PortCommand) => void): { root: HTMLElement; update(view: GameView): void } {
  const root = el('div', 'port-tavern');
  const info = el('p');
  const actions = el('div', 'port-actions');
  let last: GameView | null = null;
  const button = (label: string, run: () => PortCommand | null): void => {
    const b = el('button', undefined, label);
    b.type = 'button';
    b.addEventListener('click', () => {
      const cmd = run();
      if (cmd) send(cmd);
    });
    actions.append(b);
  };
  button('+1 tayfa', () => ({ type: 'hire', qty: 1 }));
  button('+10 tayfa', () => ({ type: 'hire', qty: 10 }));
  button('Tamamla', () => {
    const port = last?.port;
    if (!port || !last) return null;
    const qty = Math.min(port.room, Math.floor(last.captain.gold / port.hirePrice));
    return qty >= 1 ? { type: 'hire', qty } : null;
  });
  button('−1 tayfa', () => ({ type: 'discharge', qty: 1 }));
  root.append(info, actions);
  return {
    root,
    update(view): void {
      last = view;
      const port = view.port;
      if (!port) return;
      info.textContent = `Tayfa ${view.company.count} / ${view.company.max} · tayfa başı ${port.hirePrice} altın · yer: ${port.room}`;
    },
  };
}
