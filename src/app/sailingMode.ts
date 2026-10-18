import { angleDiff, createInput, type Controls } from '../core';
import { createGame } from '../gameplay';
import { createSailingView } from '../render';
import { createShip, getShipSpec, type Ship, type ShipSpec } from '../ships';
import { createHud, createMapUi, createPortPanel } from '../ui';
import type { Mode } from './mode';

const PORT = ['KeyA', 'ArrowLeft'];
const STARBOARD = ['KeyD', 'ArrowRight'];
const MORE_SAIL = ['KeyW', 'ArrowUp'];
const LESS_SAIL = ['KeyS', 'ArrowDown'];
const INTERACT = 'KeyF';
const FIRE_PORT = 'KeyQ';
const FIRE_STARBOARD = 'KeyE';
const RESTART = 'KeyR';
const MAP = 'KeyM';
const AIM = 'KeyG';
const GAME_KEYS = [...PORT, ...STARBOARD, ...MORE_SAIL, ...LESS_SAIL];

/** Free sailing on the open sea with the chosen ship. Esc returns via `onExit`. */
export function startSailingMode(host: HTMLElement, spec: ShipSpec, onExit: () => void): Mode {
  const input = createInput();
  const game = createGame(spec);
  const ship = createShip(spec);
  const view = createSailingView(host);
  view.setPlayer(ship.root, { length: spec.length, beam: spec.beam });
  const hud = createHud(host, spec.name);
  // Enemy ships: a model per id the game reports, created on first sight and dropped when gone.
  const enemyShips = new Map<string, Ship>();
  const map = createMapUi(host);
  const portPanel = createPortPanel(host);

  let aimOn = true;
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') onExit();
    else if (e.code === MAP && !e.repeat) map.toggle();
    else if (e.code === AIM && !e.repeat) view.setAimVisible((aimOn = !aimOn));
    else if (GAME_KEYS.includes(e.code)) e.preventDefault(); // keep arrows from scrolling the page
  };
  window.addEventListener('keydown', onKey);

  const any = (codes: string[], test: (code: string) => boolean): boolean => codes.some(test);
  // A key press is one sail step, even when a frame runs several fixed updates.
  let updated = false;
  let stepTaken = false;
  let interactTaken = false;
  let fireTaken = false;

  const controls = (): Controls => {
    let sailStep: -1 | 0 | 1 = 0;
    if (!stepTaken) {
      if (any(MORE_SAIL, input.pressed)) sailStep = 1;
      else if (any(LESS_SAIL, input.pressed)) sailStep = -1;
      stepTaken = sailStep !== 0;
    }
    const rudder = (any(STARBOARD, input.isDown) ? 1 : 0) - (any(PORT, input.isDown) ? 1 : 0);
    // Like sail steps, a single press must act once even if a frame runs several updates.
    const interact = !interactTaken && input.pressed(INTERACT);
    if (interact) interactTaken = true;
    // Fire and restart presses are one-shot too; the game ignores repeats while reloading.
    const firePort = !fireTaken && input.pressed(FIRE_PORT);
    const fireStarboard = !fireTaken && input.pressed(FIRE_STARBOARD);
    if (firePort || fireStarboard) fireTaken = true;
    return { rudder, sailStep, interact, firePort, fireStarboard, restart: input.pressed(RESTART) };
  };

  const syncEnemies = (v: ReturnType<typeof game.view>): void => {
    const live = new Set<string>();
    for (const e of v.enemies) {
      live.add(e.id);
      let es = enemyShips.get(e.id);
      if (!es) {
        const enemySpec = getShipSpec(e.specId);
        if (!enemySpec) continue;
        es = createShip(enemySpec);
        enemyShips.set(e.id, es);
        view.addActor(e.id, es.root, { length: enemySpec.length, beam: enemySpec.beam });
      }
      es.setSailTrim(angleDiff(v.wind.from, e.heading), e.sailLevel);
    }
    for (const [id, es] of enemyShips) {
      if (live.has(id)) continue;
      view.removeActor(id);
      es.dispose();
      enemyShips.delete(id);
    }
  };

  return {
    update(dt): void {
      game.update(dt, controls());
      updated = true;
    },
    render(): void {
      const v = game.view();
      ship.setSailTrim(angleDiff(v.wind.from, v.ship.heading), v.ship.sailLevel);
      syncEnemies(v);
      view.draw(v);
      hud.update(v);
      map.update(v);
      portPanel.update(v);
      if (updated) {
        input.endFrame(); // keep unconsumed presses if no update ran this frame
        updated = false;
        stepTaken = false;
        interactTaken = false;
        fireTaken = false;
      }
    },
    dispose(): void {
      window.removeEventListener('keydown', onKey);
      input.dispose();
      hud.dispose();
      map.dispose();
      portPanel.dispose();
      view.dispose();
      ship.dispose();
      for (const es of enemyShips.values()) es.dispose();
      enemyShips.clear();
    },
  };
}
