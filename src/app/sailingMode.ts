import { angleDiff, createInput, type Controls } from '../core';
import { createGame } from '../gameplay';
import { createSailingView } from '../render';
import { createShip, type ShipSpec } from '../ships';
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
      ship.setSailTrim(angleDiff(v.wind.from, v.ship.heading), v.ship.sailLevel);
      view.draw(v);
      hud.update(v);
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
      view.dispose();
      ship.dispose();
    },
  };
}
