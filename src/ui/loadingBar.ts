import { isLoading, loadFraction, subscribeLoad } from '../core';

export interface LoadingBar {
  /** Show the bar over `parent` (a title and a percentage that follow the downloads). */
  show(parent: HTMLElement, label?: string): void;
  hide(): void;
}

const CSS = `
.loading-bar{position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:14px;background:#0b1a24;color:#d9e6ee;font:600 15px system-ui,sans-serif;letter-spacing:.04em}
.loading-bar .track{width:min(320px,70vw);height:6px;border-radius:3px;background:#1b3342;overflow:hidden}
.loading-bar .notice{position:absolute;bottom:14px;font:400 12px system-ui,sans-serif;opacity:.55;letter-spacing:0}
.loading-bar .fill{height:100%;width:0;background:#e0b65a;transition:width .15s ease-out}
`;

export function createLoadingBar(): LoadingBar {
  let el: HTMLDivElement | undefined;
  let unsubscribe: (() => void) | undefined;

  return {
    show(parent, label = 'Yükleniyor') {
      if (el) return;
      const style = document.createElement('style');
      style.textContent = CSS;
      const text = document.createElement('div');
      const fill = document.createElement('div');
      fill.className = 'fill';
      const track = document.createElement('div');
      track.className = 'track';
      track.append(fill);
      el = document.createElement('div');
      el.className = 'loading-bar';
      const notice = document.createElement('div');
      notice.className = 'notice';
      notice.textContent = '© gkaragoz and Contributors';
      el.append(style, text, track, notice);
      parent.append(el);
      let started = false; // before the first download is announced the bar reads 0, not 100
      const paint = (): void => {
        if (isLoading()) started = true;
        const pct = isLoading() ? Math.floor(loadFraction() * 100) : started ? 100 : 0;
        text.textContent = `${label}… %${pct}`;
        fill.style.width = `${pct}%`;
      };
      paint();
      unsubscribe = subscribeLoad(paint);
    },
    hide() {
      unsubscribe?.();
      el?.remove();
      el = undefined;
    },
  };
}
