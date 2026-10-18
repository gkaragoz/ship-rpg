import { CONFIG, type GameView } from '../core';
import { getNation } from '../world';
import './hud.css';

export interface Hud {
  update(view: GameView): void;
  /** Show a short message (a setting changed, e.g. mute). */
  notice(text: string): void;
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
const pct = (v: number): string => `${Math.round(Math.min(Math.max(v, 0), 1) * 100)}%`;
const TOAST_SECONDS = 3.5;

/** Replay a CSS animation from the start, even if it is already running. */
function restart(node: HTMLElement): void {
  node.classList.remove('on');
  void node.offsetWidth;
  node.classList.add('on');
}

/** A labelled thin bar; `fill` is the inner element whose width is set. */
function bar(className = ''): { root: HTMLElement; fill: HTMLElement } {
  const root = el('div', `hud-bar ${className}`.trim());
  const fill = el('div');
  root.append(fill);
  return { root, fill };
}

/** Sailing HUD: heading, speed, sails, wind compass, hull and guns, target, prompts. */
export function createHud(host: HTMLElement, shipName: string): Hud {
  const root = el('div', 'hud');

  const panel = el('section', 'hud-panel');
  const compass = el('div', 'hud-compass');
  const bow = el('div', 'hud-bow');
  const arrow = el('div', 'hud-wind');
  const portMark = el('div', 'hud-port');
  compass.append(bow, arrow, portMark);
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
  const portEl = rowValue('Liman');
  const hullEl = rowValue('Gövde');
  const drive = bar();
  const hull = bar('hud-hull');

  // Broadsides: left and right, each a bar that fills while loaded.
  const guns = el('div', 'hud-guns');
  const gunPort = bar('hud-gun');
  const gunStbd = bar('hud-gun');
  const gunLabel = (text: string, b: HTMLElement): HTMLElement => {
    const w = el('div', 'hud-gun-wrap');
    w.append(el('span', undefined, text), b);
    return w;
  };
  guns.append(gunLabel('Sol (Q)', gunPort.root), gunLabel('Sağ (E)', gunStbd.root));
  panel.append(el('h3', undefined, shipName), compass, rows, drive.root, hull.root, guns);

  // Nearest enemy.
  const target = el('div', 'hud-target');
  target.hidden = true;
  const targetChip = el('span', 'hud-chip');
  const targetName = el('div');
  targetName.prepend(targetChip);
  const targetText = el('span');
  targetName.append(targetText);
  const targetBar = bar('hud-hull');
  target.append(targetName, targetBar.root);

  const help = el('div', 'hud-help', 'A/D dümen · W/S yelken · Q/E top · G nişan · N ses · F liman · M harita · Fare: kamera · Esc: galeri');
  const prompt = el('div', 'hud-prompt');
  prompt.hidden = true;
  const toast = el('div', 'hud-toast');
  toast.hidden = true;
  const hurt = el('div', 'hud-hurt');
  const marker = el('div', 'hud-hitmarker', '✕');
  const sunk = el('div', 'hud-sunk');
  sunk.hidden = true;
  sunk.append(el('h2', undefined, 'Gemin battı'), el('p', undefined, 'R: yeniden başla'));
  root.append(panel, help, target, prompt, toast, hurt, marker, sunk);
  host.appendChild(root);

  let toastLeft = 0;
  let lastClock = performance.now();

  return {
    notice(text): void {
      toast.textContent = text;
      toastLeft = 1.8;
    },
    update(view): void {
      const { ship, wind, nearestPort, docked, grounded } = view;
      const now = performance.now();
      const dt = Math.min((now - lastClock) / 1000, 0.5);
      lastClock = now;

      headingEl.textContent = `${bearing(ship.heading).toFixed(0).padStart(3, '0')}°`;
      speedEl.textContent = `${ship.knots.toFixed(1)} / ${ship.maxKnots.toFixed(1)}`;
      windEl.textContent = `${bearing(wind.from).toFixed(0).padStart(3, '0')}° · ${wind.speed.toFixed(1)} m/s`;
      const steps = ['Toplu', 'Yarım', 'Tam'];
      sailEl.textContent = steps[Math.round(ship.sailTarget * 2)] ?? '';
      const eff = ship.efficiency;
      driveEl.textContent = eff < 0.05 ? 'Rüzgâra karşı!' : `${Math.round(eff * 100)}%`;
      drive.fill.style.width = pct(eff);
      // The arrow is drawn pointing at the stern (wind from dead ahead); rotating it by the
      // wind's relative bearing makes it point where the wind blows toward.
      arrow.style.transform = `rotate(${(ship.heading - wind.from) * DEG}deg)`;

      // Hull and guns.
      hullEl.textContent = `${Math.round(ship.hp)} / ${ship.maxHp}`;
      hull.fill.style.width = pct(ship.hp / ship.maxHp);
      hull.root.classList.toggle('low', ship.hp / ship.maxHp < 0.3);
      guns.hidden = ship.guns === 0;
      gunPort.fill.style.width = pct(1 - ship.reload.port);
      gunStbd.fill.style.width = pct(1 - ship.reload.starboard);
      gunPort.root.classList.toggle('ready', ship.reload.port <= 0);
      gunStbd.root.classList.toggle('ready', ship.reload.starboard <= 0);
      // Glow when a loaded broadside has an enemy in its landing zone: that is the moment to fire.
      gunPort.root.classList.toggle('hot', ship.reload.port <= 0 && ship.inRange.port);
      gunStbd.root.classList.toggle('hot', ship.reload.starboard <= 0 && ship.inRange.starboard);

      // Nearest port: distance, compass bearing and a marker on the compass ring.
      portMark.hidden = !nearestPort;
      if (nearestPort) {
        const km = nearestPort.distance >= 1000;
        const dist = km ? `${(nearestPort.distance / 1000).toFixed(1)} km` : `${Math.round(nearestPort.distance)} m`;
        portEl.textContent = `${nearestPort.name} · ${dist} · ${bearing(nearestPort.direction).toFixed(0).padStart(3, '0')}°`;
        portMark.style.transform = `rotate(${(ship.heading - nearestPort.direction) * DEG}deg)`;
      } else {
        portEl.textContent = '—';
      }

      // Nearest enemy afloat within sight.
      let foe = null as GameView['enemies'][number] | null;
      for (const e of view.enemies) if (e.sinking < 0 && (!foe || e.distance < foe.distance)) foe = e;
      target.hidden = !foe || foe.distance > CONFIG.giveUpRange || view.sunk;
      if (foe) {
        const nation = getNation(foe.nation);
        targetChip.style.background = `#${nation.flag.toString(16).padStart(6, '0')}`;
        targetText.textContent = `${nation.name} ${foe.name}${foe.fleeing ? ' (kaçıyor)' : ''} · ${Math.round(foe.distance)} m · ${bearing(foe.direction).toFixed(0).padStart(3, '0')}°`;
        targetBar.fill.style.width = pct(foe.hp / foe.maxHp);
      }

      // Hit feedback: a red flash when we are hit, a marker when our shot lands.
      if (view.events.some((e) => e.type === 'hit' && e.owner === 'enemy')) restart(hurt);
      if (view.events.some((e) => e.type === 'hit' && e.owner === 'player')) restart(marker);

      // Toast for a kill; the sunk screen for our own end.
      if (view.events.some((e) => e.type === 'sunk' && e.owner === 'enemy')) {
        toast.textContent = `Düşman gemisi battı! (${view.kills})`;
        toastLeft = TOAST_SECONDS;
      } else if (view.events.some((e) => e.type === 'escaped')) {
        toast.textContent = 'Düşman gemisi gözden kayboldu';
        toastLeft = TOAST_SECONDS;
      }
      toastLeft = Math.max(0, toastLeft - dt);
      toast.hidden = toastLeft <= 0;
      sunk.hidden = !view.sunk || view.sinkTime < 2;

      if (view.sunk) {
        prompt.hidden = true;
      } else if (grounded) {
        prompt.hidden = false;
        prompt.textContent = 'Karaya oturdun! Dümeni kır, kıçtan çık.';
        prompt.className = 'hud-prompt hud-warn';
      } else if (docked) {
        prompt.hidden = true;
      } else if (nearestPort?.dockable) {
        prompt.hidden = false;
        prompt.textContent = `${nearestPort.name} limanına gir [F]`;
        prompt.className = 'hud-prompt';
      } else if (nearestPort && nearestPort.distance < 200) {
        prompt.hidden = false;
        prompt.textContent = 'Limana girmek için yavaşla (W/S: yelken)';
        prompt.className = 'hud-prompt';
      } else {
        prompt.hidden = true;
      }
    },
    dispose(): void {
      root.remove();
    },
  };
}
