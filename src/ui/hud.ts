import type { GameView } from '../core';
import './hud.css';

export interface Hud {
  update(view: GameView): void;
  dispose(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const DEG = 180 / Math.PI;
/** Compass bearing (clockwise from north, north = -z) of a world heading angle. */
const bearing = (angle: number): number => (((Math.PI / 2 - angle) * DEG) % 360 + 360) % 360;

/** Sailing HUD: heading, speed, sails, wind compass and key hints. */
export function createHud(host: HTMLElement, shipName: string): Hud {
  const root = el('div', 'hud');

  const panel = el('section', 'hud-panel');
  const compass = el('div', 'hud-compass');
  const bow = el('div', 'hud-bow');
  const arrow = el('div', 'hud-wind');
  compass.append(bow, arrow);
  const rows = el('dl');
  const rowValue = (label: string): HTMLElement => {
    const dd = el('dd');
    rows.append(el('dt', undefined, label), dd);
    return dd;
  };
  const headingEl = rowValue('Rota');
  const speedEl = rowValue('Hız');
  const windEl = rowValue('Rüzgâr');
  const sailEl = rowValue('Yelken');
  const driveEl = rowValue('Verim');
  const drive = el('div', 'hud-bar');
  const driveFill = el('div');
  drive.append(driveFill);
  panel.append(el('h3', undefined, shipName), compass, rows, drive);

  const help = el('div', 'hud-help', 'A / D dümen · W / S yelken · Fare: kamera · Esc: galeri');
  root.append(panel, help);
  host.appendChild(root);

  return {
    update({ ship, wind }): void {
      headingEl.textContent = `${bearing(ship.heading).toFixed(0).padStart(3, '0')}°`;
      speedEl.textContent = `${ship.knots.toFixed(1)} / ${ship.maxKnots.toFixed(1)}`;
      windEl.textContent = `${bearing(wind.from).toFixed(0).padStart(3, '0')}° · ${wind.speed.toFixed(1)} m/s`;
      const steps = ['Toplu', 'Yarım', 'Tam'];
      sailEl.textContent = steps[Math.round(ship.sailTarget * 2)] ?? '';
      const eff = ship.efficiency;
      driveEl.textContent = eff < 0.05 ? 'Rüzgâra karşı!' : `${Math.round(eff * 100)}%`;
      driveFill.style.width = `${Math.round(eff * 100)}%`;
      // The arrow is drawn pointing at the stern (wind from dead ahead); rotating it by the
      // wind's relative bearing makes it point where the wind blows toward.
      arrow.style.transform = `rotate(${(ship.heading - wind.from) * DEG}deg)`;
    },
    dispose(): void {
      root.remove();
    },
  };
}
