import type { GameView } from '../core';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const money = (n: number): string => Math.round(n).toLocaleString('tr-TR');

export interface CaptainHud {
  root: HTMLElement;
  /** Fill the rows from the view; `announce` shows a short message (loot, boarding, a new level). */
  update(view: GameView, announce: (text: string) => void): void;
}

/** Gold, level and experience, crew and hold: the captain's rows in the HUD panel. */
export function createCaptainHud(): CaptainHud {
  const root = el('div', 'hud-captain');
  const rows = el('dl');
  const row = (label: string): HTMLElement => {
    const dd = el('dd');
    rows.append(el('dt', undefined, label), dd);
    return dd;
  };
  const goldEl = row('Altın');
  const levelEl = row('Seviye');
  const crewEl = row('Mürettebat');
  const holdEl = row('Ambar');
  const xp = el('div', 'hud-bar hud-xp');
  const xpFill = el('div');
  xp.append(xpFill);
  root.append(rows, xp);

  return {
    root,
    update(view, announce): void {
      const { captain, company, cargo } = view;
      goldEl.textContent = money(captain.gold);
      levelEl.textContent = `${captain.level}${captain.xpForNext > 0 ? ` · ${captain.xpIntoLevel}/${captain.xpForNext}` : ' (en üst)'}`;
      xpFill.style.width = `${captain.xpForNext > 0 ? Math.min(100, (captain.xpIntoLevel / captain.xpForNext) * 100) : 100}%`;
      crewEl.textContent = `${company.count} / ${company.max}`;
      crewEl.classList.toggle('alert', company.factor < 0.75);
      holdEl.textContent = `${cargo.used} / ${cargo.capacity}`;
      for (const e of view.events) {
        if (e.type === 'boarded') announce(e.won ? `Gemi ele geçirildi! (${e.amount ?? 0} kayıp)` : `Baskın püskürtüldü! (${e.amount ?? 0} kayıp)`);
        else if (e.type === 'loot') {
          announce(`Ganimet: ${money(e.gold ?? 0)} altın${(e.amount ?? 0) > 0 ? ` + ${e.amount} yük` : ''}`);
        } else if (e.type === 'levelup') announce(`Seviye ${e.level}!`);
      }
    },
  };
}
