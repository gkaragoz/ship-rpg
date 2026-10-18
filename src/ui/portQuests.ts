import type { GameView, PortCommand } from '../core';
import { NATIONS, NAVIES, getNation } from '../world';
import { el } from './dom';
import { reasonText } from './portMarket';

const gold = (n: number): string => Math.round(n).toLocaleString('tr-TR');
const KIND: Record<string, string> = { delivery: 'Teslimat', courier: 'Mektup', hunt: 'Av' };

/** The errands tab: the tavern's board, the errands carried, and the captain's standing with each navy. */
export function createQuestsTab(send: (cmd: PortCommand) => void): { root: HTMLElement; update(view: GameView): void } {
  const root = el('div', 'port-quests');
  const standing = el('div', 'port-standing');
  const activeHead = el('h4', undefined, 'Üstlendiğin görevler');
  const active = el('div', 'port-quest-list');
  const offersHead = el('h4', undefined, 'Meyhanenin panosu');
  const offers = el('div', 'port-quest-list');
  root.append(standing, activeHead, active, offersHead, offers);
  let key = '';

  return {
    root,
    update(view): void {
      const q = view.port?.quests;
      if (!q) return;
      const fingerprint = [
        ...NAVIES.map((n) => view.reputation[n] ?? 0),
        '|', ...q.active.map((a) => `${a.id}:${a.progress}:${a.ready}`), '|', ...q.offers.map((o) => `${o.id}:${o.deadline ?? ''}`), q.room,
      ].join(',');
      if (fingerprint === key) return;
      key = fingerprint;

      standing.replaceChildren(el('span', 'port-standing-title', 'İtibar'));
      for (const n of [...NAVIES, 'pirate']) {
        const v = view.reputation[n] ?? 0;
        const chip = el('span', `port-chip${v <= -50 ? ' bad' : v >= 30 ? ' good' : ''}`, `${getNation(n).name} ${v > 0 ? '+' : ''}${v}`);
        chip.title = v <= -50 && n !== 'pirate' ? 'Bu ulusun limanları sana kapalı' : v <= -20 && n !== 'pirate' ? 'Bu ulusun donanması seni avlıyor' : '';
        standing.append(chip);
      }

      active.replaceChildren();
      if (q.active.length === 0) active.append(el('p', 'port-empty', 'Henüz bir görevin yok.'));
      for (const a of q.active) {
        const row = el('div', 'port-quest-row');
        row.append(el('span', 'port-quest-kind', KIND[a.kind] ?? a.kind), el('span', 'port-quest-title', a.title), el('span', a.ready ? 'port-quest-ready' : undefined, a.progress), el('span', undefined, `${gold(a.reward)} altın`));
        const drop = el('button', undefined, 'Bırak');
        drop.type = 'button';
        drop.addEventListener('click', () => send({ type: 'abandonQuest', id: a.id }));
        row.append(drop);
        active.append(row);
      }

      offers.replaceChildren();
      if (q.offers.length === 0) offers.append(el('p', 'port-empty', 'Bugünkü görevlerin hepsini aldın; yarın yeni görevler çıkar.'));
      for (const o of q.offers) {
        const row = el('div', 'port-quest-row');
        const nation = NATIONS.find((n) => n.id === o.repNation)?.name ?? '';
        row.append(el('span', 'port-quest-kind', KIND[o.kind] ?? o.kind), el('span', 'port-quest-title', o.title), el('span', undefined, o.deadline !== undefined ? `${o.deadline} sn` : nation), el('span', undefined, `${gold(o.reward)} altın`));
        const take = el('button', undefined, 'Üstlen');
        take.type = 'button';
        take.disabled = q.room <= 0;
        take.title = q.room <= 0 ? reasonText({ ok: false, reason: 'quests-full' }) : `${nation ? `${nation} itibarı artar` : ''}`;
        take.addEventListener('click', () => send({ type: 'acceptQuest', id: o.id }));
        row.append(take);
        offers.append(row);
      }
    },
  };
}
