import type { CommandResult, GameView, MarketLineView, PortCommand } from '../core';
import { GOODS } from '../world';
import { el } from './dom';

const gold = (n: number): string => Math.round(n).toLocaleString('tr-TR');

/** The market tab: every good with its buy and sell price, what the hold has, and buy / sell buttons. */
export function createMarketTab(send: (cmd: PortCommand) => void): { root: HTMLElement; update(view: GameView): void } {
  const root = el('div', 'port-market');
  const head = el('div', 'port-row port-head');
  for (const h of ['Mal', 'Al', 'Sat', 'Ambar', '']) head.append(el('span', undefined, h));
  root.append(head);
  let last: GameView | null = null;

  const rows = GOODS.map((g) => {
    const row = el('div', 'port-row');
    const name = el('span', 'port-name', g.name);
    const buy = el('span');
    const sell = el('span');
    const held = el('span');
    const actions = el('span', 'port-actions');
    const line = (): MarketLineView | undefined => last?.port?.market.find((m) => m.good === g.id);
    const button = (label: string, title: string, run: () => PortCommand | null): void => {
      const b = el('button', undefined, label);
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', () => {
        const cmd = run();
        if (cmd) send(cmd);
      });
      actions.append(b);
    };
    button('+1', 'Al: 1', () => ({ type: 'buy', good: g.id, qty: 1 }));
    button('+10', 'Al: 10', () => ({ type: 'buy', good: g.id, qty: 10 }));
    button('Maks', 'Paranın ve ambarın yettiği kadar al', () => {
      const l = line();
      if (!l || !last) return null;
      const qty = Math.floor(Math.min(last.captain.gold / l.buy, last.cargo.capacity - last.cargo.used));
      return qty >= 1 ? { type: 'buy', good: g.id, qty } : null;
    });
    button('−1', 'Sat: 1', () => ({ type: 'sell', good: g.id, qty: 1 }));
    button('−10', 'Sat: 10', () => ({ type: 'sell', good: g.id, qty: 10 }));
    button('Hepsi', 'Elindekinin hepsini sat', () => {
      const l = line();
      return l && l.held > 0 ? { type: 'sell', good: g.id, qty: l.held } : null;
    });
    row.append(name, buy, sell, held, actions);
    root.append(row);
    return { id: g.id, row, buy, sell, held };
  });

  return {
    root,
    update(view): void {
      last = view;
      const port = view.port;
      if (!port) return;
      for (const r of rows) {
        const l = port.market.find((m) => m.good === r.id);
        if (!l) continue;
        r.buy.textContent = gold(l.buy);
        r.sell.textContent = gold(l.sell);
        r.held.textContent = String(l.held);
        r.row.classList.toggle('cheap', l.trend < 0.9);
        r.row.classList.toggle('dear', l.trend > 1.1);
      }
    },
  };
}

/** The words for a refused command. */
export function reasonText(r: CommandResult): string {
  switch (r.reason) {
    case 'no-gold': return 'Yeterli altının yok';
    case 'no-space': return 'Ambarda yer yok';
    case 'no-stock': return 'Ambarda o kadar yok';
    case 'crew-full': return 'Gemide daha fazla yer yok';
    case 'no-crew': return 'O kadar tayfa yok';
    case 'busy': return 'Gemi hazırlanıyor…';
    case 'nothing-to-repair': return 'Onarılacak bir şey yok';
    case 'hold-too-small': return 'Ambar küçük: önce yükü sat';
    case 'not-sold': return 'Bu tersane yapmıyor';
    case 'same-ship': return 'Bu zaten senin geminin kendisi';
    case 'fleet-full': return 'Filoda yer yok (en çok 3 eşlik gemisi)';
    case 'no-such-ship': return 'Böyle bir gemi filoda yok';
    case 'bad-good': return 'Böyle bir mal yok';
    case 'not-docked': return 'Limanda değilsin';
    default: return 'Olmadı';
  }
}
