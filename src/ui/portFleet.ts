import type { GameView, PortCommand } from '../core';
import { el } from './dom';
import { reasonText } from './portMarket';

const gold = (n: number): string => Math.round(n).toLocaleString('tr-TR');
const pct = (v: number): string => `${Math.round(Math.min(Math.max(v, 0), 1) * 100)}%`;

/** The fleet tab: the consorts with their hull, rigging and crew, and what to do with them (move the flag, mend, sell). */
export function createFleetTab(send: (cmd: PortCommand) => void): { root: HTMLElement; update(view: GameView): void } {
  const root = el('div', 'port-fleet');
  const info = el('p', 'port-yard-info');
  const list = el('div', 'port-fleet-list');
  root.append(info, list);
  let key = '';

  return {
    root,
    update(view): void {
      const yard = view.port?.shipyard;
      if (!yard) return;
      const room = yard.fleetRoom;
      info.textContent = `Filo: ${yard.fleet.length} gemi eşlik ediyor, ${room} yer boş. Eşlik gemileri seninle yelken açar, düşmanla savaşır; her mola başında bakım gideri ödersin.`;
      const fingerprint = yard.fleet.map((f) => `${f.index}:${f.specId}:${Math.round(f.hp)}:${Math.round(f.rigging * 100)}:${view.captain.gold >= f.repairCost}`).join('|');
      if (fingerprint === key) return;
      key = fingerprint;
      list.replaceChildren();
      if (yard.fleet.length === 0) {
        list.append(el('p', 'port-empty', 'Henüz eşlik gemin yok: tersaneden "Filoya kat" ile al ya da bir düşman gemisini abordajla ele geçir.'));
        return;
      }
      for (const f of yard.fleet) {
        const row = el('div', 'port-fleet-row');
        row.append(
          el('span', 'port-name', f.name),
          el('span', undefined, `Gövde ${pct(f.hp / f.maxHp)}`),
          el('span', undefined, `Arma ${pct(f.rigging)}`),
          el('span', undefined, `Tayfa ${f.crew}/${f.maxCrew}`),
        );
        const flag = el('button', undefined, 'Amiral yap');
        flag.type = 'button';
        flag.title = 'Bayrağı bu gemiye taşı; şu anki amiral gemin filoya geçer';
        flag.addEventListener('click', () => send({ type: 'flagship', index: f.index }));
        const mend = el('button', undefined, f.repairCost > 0 ? `Onar ${gold(f.repairCost)}` : 'Sağlam');
        mend.type = 'button';
        mend.disabled = f.repairCost <= 0 || f.repairCost > view.captain.gold;
        mend.title = f.repairCost > view.captain.gold ? reasonText({ ok: false, reason: 'no-gold' }) : '';
        mend.addEventListener('click', () => send({ type: 'repairConsort', index: f.index }));
        const sell = el('button', undefined, `Sat ${gold(f.sellPrice)}`);
        sell.type = 'button';
        sell.addEventListener('click', () => send({ type: 'sellConsort', index: f.index }));
        row.append(flag, mend, sell);
        list.append(row);
      }
    },
  };
}
