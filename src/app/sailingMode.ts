import { angleDiff, createInput, type Controls, type GameView } from '../core';
import { createGame } from '../gameplay';
import { createSailingView } from '../render';
import { createShip, getShipSpec, type Ship, type ShipLod, type ShipSpec } from '../ships';
import { createHud } from '../ui';
import type { Mode } from './mode';

const PORT = ['KeyA', 'ArrowLeft'];
const STARBOARD = ['KeyD', 'ArrowRight'];
const MORE_SAIL = ['KeyW', 'ArrowUp'];
const LESS_SAIL = ['KeyS', 'ArrowDown'];
const GAME_KEYS = [...PORT, ...STARBOARD, ...MORE_SAIL, ...LESS_SAIL];

/** Free sailing on the open sea with the chosen ship. Esc returns via `onExit`. */
export function startSailingMode(host: HTMLElement, spec: ShipSpec, onExit: () => void): Mode {
  const input = createInput();
  const game = createGame(spec);
  const ship = createShip(spec);
  const view = createSailingView(host);
  view.setPlayer(ship.root, { length: spec.length, beam: spec.beam });
  const hud = createHud(host, spec.name);

  // Other ships come from the game view; build their models the first time they appear.
  const npcs: Ship[] = [];
  const syncOthers = (v: GameView): void => {
    if (npcs.length === v.others.length) return;
    for (const o of v.others.slice(npcs.length)) {
      // Always push one ship per entry so ship i keeps matching others[i].
      npcs.push(createShip(getShipSpec(o.specId) ?? spec));
    }
    view.setOthers(npcs);
  };

  // ?lod=0|1|2 forces the level of every other ship; ?perf publishes window.__perf (fps, draw calls).
  const query = new URLSearchParams(window.location.search);
  const forced = Number(query.get('lod'));
  if (query.has('lod') && forced >= 0 && forced <= 2) view.setLodOverride(forced as ShipLod);
  const perf = query.has('perf');
  let frames = 0;
  let last = performance.now();
  let fps = 0;

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') onExit();
    else if (GAME_KEYS.includes(e.code)) e.preventDefault(); // keep arrows from scrolling the page
  };
  window.addEventListener('keydown', onKey);

  const any = (codes: string[], test: (code: string) => boolean): boolean => codes.some(test);
  // A key press is one sail step, even when a frame runs several fixed updates.
  let updated = false;
  let stepTaken = false;

  const controls = (): Controls => {
    let sailStep: -1 | 0 | 1 = 0;
    if (!stepTaken) {
      if (any(MORE_SAIL, input.pressed)) sailStep = 1;
      else if (any(LESS_SAIL, input.pressed)) sailStep = -1;
      stepTaken = sailStep !== 0;
    }
    const rudder = (any(STARBOARD, input.isDown) ? 1 : 0) - (any(PORT, input.isDown) ? 1 : 0);
    return { rudder, sailStep };
  };

  return {
    update(dt): void {
      game.update(dt, controls());
      updated = true;
    },
    render(): void {
      const v = game.view();
      syncOthers(v);
      ship.setSailTrim(angleDiff(v.wind.from, v.ship.heading), v.ship.sailLevel);
      view.draw(v);
      hud.update(v);
      if (perf) {
        frames++;
        const now = performance.now();
        if (now - last > 500) {
          fps = Math.round((frames * 1000) / (now - last));
          frames = 0;
          last = now;
        }
        Object.assign(window, { __perf: { fps, ...view.stats(), crew: v.crew.length, others: v.others.length } });
      }
      if (updated) {
        input.endFrame(); // keep unconsumed presses if no update ran this frame
        updated = false;
        stepTaken = false;
      }
    },
    dispose(): void {
      window.removeEventListener('keydown', onKey);
      input.dispose();
      hud.dispose();
      view.dispose(); // also disposes the other ships it was given
      ship.dispose();
    },
  };
}
