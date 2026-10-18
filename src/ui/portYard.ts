import type { GameView, PortCommand } from '../core';
import { el } from './dom';

const gold = (n: number): string => Math.round(n).toLocaleString('tr-TR');

const REASONS: Record<string, string> = {
  'no-gold': 'Altının yetmiyor',
  'hold-too-small': 'Ambar küçük: önce yükü sat',
  'same-ship': 'Bu senin geminin kendisi',
  'not-sold': 'Bu tersane yapmıyor',
};

/** The shipyard tab: repair the ship, and buy another (the yard buys yours in part exchange). */
export function createYardTab(send: (cmd: PortCommand) => void): { root: HTMLElement; update(view: GameView): void } {
  const root = el('div', 'port-yard');
  const info = el('p', 'port-yard-info');
  const repair = el('button', undefined, 'Onar');
  repair.type = 'button';
  repair.addEventListener('click', () => send({ type: 'repair' }));
  const head = el('div', 'port-yard-row port-head');
  for (const h of ['Gemi', 'Fiyat', 'Fark', 'Gövde', 'Hız', 'Top', 'Ambar', 'Tayfa', '']) head.append(el('span', undefined, h));
  const list = el('div', 'port-yard-list');
  root.append(info, repair, head, list);

  interface Row { id: string; row: HTMLElement; price: HTMLElement; net: HTMLElement; buy: HTMLButtonElement }
  let rows: Row[] = [];
  let key = '';

  const build = (view: GameView): void => {
    const offers = view.port?.shipyard.offers ?? [];
    key = offers.map((o) => o.specId).join();
    list.replaceChildren();
    rows = offers.map((o) => {
      const row = el('div', 'port-yard-row');
      const buy = el('button', undefined, 'Satın al');
      buy.type = 'button';
      buy.addEventListener('click', () => send({ type: 'buyShip', specId: o.specId }));
      const price = el('span');
      const net = el('span');
      row.append(el('span', 'port-name', o.name), price, net, el('span', undefined, String(o.hp)), el('span', undefined, String(o.speed)), el('span', undefined, String(o.cannons)), el('span', undefined, String(o.hold)), el('span', undefined, String(o.crew)), buy);
      list.append(row);
      return { id: o.specId, row, price, net, buy };
    });
  };

  return {
    root,
    update(view): void {
      const yard = view.port?.shipyard;
      if (!yard) return;
      if (key !== yard.offers.map((o) => o.specId).join()) build(view);
      info.textContent = `Gemin ${view.ship.name}: tersane ${gold(yard.tradeIn)} altına alır · tam onarım ${gold(yard.repairCost)} altın`;
      repair.disabled = yard.repairCost <= 0;
      for (const r of rows) {
        const o = yard.offers.find((x) => x.specId === r.id);
        if (!o) continue;
        r.price.textContent = gold(o.price);
        r.net.textContent = gold(o.net);
        r.row.classList.toggle('current', o.current);
        r.buy.disabled = !!o.reason;
        r.buy.title = o.reason ? (REASONS[o.reason] ?? 'Olmaz') : `${gold(o.net)} altına al`;
        r.buy.textContent = o.current ? 'Senin' : 'Satın al';
      }
    },
  };
}
