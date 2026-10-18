import { createAudio } from '../audio';
import { angleDiff, createInput, type Controls, type GameView } from '../core';
import { createGame } from '../gameplay';
import { createAutoQuality, createSailingView, lowerQuality, nextQuality } from '../render';
import { getSettings } from '../settings';
import { createShip, getShipSpec, type Ship, type ShipLod, type ShipSpec } from '../ships';
import { createHud, createMapUi, createPortPanel, createSettingsUI, weatherTab } from '../ui';
import { getNation } from '../world';
import { gameLines, renderLines } from './debugLines';
import { applyGameSettings } from './gameSettings';
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
const MUTE = 'KeyN';
const QUALITY = 'KeyK';
const GAME_KEYS = [...PORT, ...STARBOARD, ...MORE_SAIL, ...LESS_SAIL];

/** Free sailing on the open sea with the chosen ship. Esc opens the settings menu, which has the way back (`onExit`). */
export function startSailingMode(host: HTMLElement, spec: ShipSpec, onExit: () => void): Mode {
  const input = createInput();
  const game = createGame(spec);
  // In dev, expose the game on window so it can be poked from the browser console (e.g. __game.dev.setKills(4)).
  if (import.meta.env.DEV) (window as unknown as { __game?: typeof game }).__game = game;
  const ship = createShip(spec, { flag: getNation('free').flag }); // the player is a free captain
  const store = getSettings();
  // A quality asked for in the URL is kept as it is; otherwise the game may lower the water quality when frames run slow.
  const urlQuality = new URLSearchParams(window.location.search).has('quality');
  const autoQuality = createAutoQuality();
  let lastRender = performance.now();
  const view = createSailingView(host, store.get().graphics);
  view.setPlayer(ship.root, { length: spec.length, beam: spec.beam });
  const hud = createHud(host, spec.name);
  // Enemy ships: a model per id the game reports, created on first sight and dropped when gone.
  const enemyShips = new Map<string, Ship>();
  const map = createMapUi(host);
  const portPanel = createPortPanel(host);
  const audio = createAudio();
  let paused = false;
  let lastView: GameView | null = null;
  const settingsUI = createSettingsUI(host, store, {
    onExit: { label: 'Galeriye dön', run: onExit },
    onOpenChange: (open) => (paused = open),
    extraTabs: [weatherTab({ hour: () => lastView?.hour ?? 9, setHour: (h) => game.setClock({ hour: h }) })],
  });
  // Settings reach the view, the sound and the page whenever they change (and once now).
  let water = store.get().graphics.water;
  let chosenWater = false; // the player changed the water quality (menu or K): the automatic step-down leaves it alone
  let autoChange = false;
  const applySettings = (): void => {
    const s = store.get();
    if (s.graphics.water !== water) {
      water = s.graphics.water;
      if (!autoChange) chosenWater = true;
    }
    view.setGraphics(s.graphics);
    audio.setVolumes(s.audio);
    view.setCameraSensitivity(s.game.cameraSensitivity);
    game.setClock({ dayMinutes: s.game.dayMinutes, frozen: s.game.freezeTime });
    applyGameSettings(s.game);
  };
  applySettings();
  const unsubscribe = store.subscribe(applySettings);

  let aimOn = true;
  // Ambient ships come from the game view; build their models the first time they appear.
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
  const sea = Number(query.get('sea')); // ?sea=0…1 forces the sea state (calm … storm) for looking at the weather
  if (query.has('sea') && Number.isFinite(sea)) game.dev.setSea(sea);
  let frames = 0;
  let last = performance.now();
  let fps = 0;

  const onKey = (e: KeyboardEvent): void => {
    audio.resume(); // browsers only start audio after a user gesture
    if (e.code === 'Escape') {
      if (!e.repeat && !(e.target instanceof HTMLSelectElement)) settingsUI.toggle(); // Esc closes an open drop-down, not the menu
    }
    else if (paused) return; // the menu is open: the game keys wait
    else if (e.code === MAP && !e.repeat) map.toggle();
    else if (e.code === QUALITY && !e.repeat) {
      store.patch({ graphics: { water: nextQuality(store.get().graphics.water) } });
      hud.notice(`Grafik: ${store.get().graphics.water}`);
    } else if (e.code === MUTE && !e.repeat) {
      const muted = !store.get().audio.muted;
      store.patch({ audio: { muted } });
      hud.notice(muted ? 'Ses kapalı' : 'Ses açık');
    }
    else if (e.code === AIM && !e.repeat) {
      view.setAimVisible((aimOn = !aimOn));
      hud.notice(aimOn ? 'Nişan bölgeleri açık' : 'Nişan bölgeleri kapalı');
    }
    else if (GAME_KEYS.includes(e.code)) e.preventDefault(); // keep arrows from scrolling the page
  };
  window.addEventListener('keydown', onKey);
  const onPointer = (): void => audio.resume(); // a click or drag also counts as a user gesture
  window.addEventListener('pointerdown', onPointer);

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
        es = createShip(enemySpec, { flag: getNation(e.nation).flag });
        enemyShips.set(e.id, es);
        view.addActor(e.id, es.root, { length: enemySpec.length, beam: enemySpec.beam });
      }
      es.setSailTrim(angleDiff(v.wind.from, e.heading), e.sailLevel);
      es.setCondition(e, v.time);
    }
    for (const [id, es] of enemyShips) {
      if (live.has(id)) continue;
      view.removeActor(id);
      es.dispose();
      enemyShips.delete(id);
    }
  };

  return {
    debugInfo: () => [...renderLines(view.stats(), store.get().graphics), ...(lastView ? gameLines(lastView) : [])],
    update(dt): void {
      if (paused) return; // the settings menu stops the game
      game.update(dt, controls());
      updated = true;
    },
    render(): void {
      const now = performance.now();
      const slow = autoQuality.frame((now - lastRender) / 1000);
      const g = store.get().graphics;
      // Not when the frame rate is capped on purpose (a 30 fps limit looks slow), nor once the player chose a water quality.
      const capped = g.fpsLimit > 0 && g.fpsLimit < 45;
      if (slow && g.autoQuality && !urlQuality && !capped && !chosenWater && g.water !== 'low') {
        const lower = lowerQuality(g.water);
        autoChange = true;
        store.patch({ graphics: { water: lower } }, false); // not saved: the next start tries the chosen quality again
        autoChange = false;
        hud.notice(`Grafik düşürüldü: ${lower}`);
      }
      lastRender = now;
      const v = game.view();
      lastView = v;
      syncOthers(v);
      ship.setSailTrim(angleDiff(v.wind.from, v.ship.heading), v.ship.sailLevel);
      ship.setCondition(v.ship, v.time);
      syncEnemies(v);
      view.draw(v);
      hud.update(v);
      map.update(v);
      portPanel.update(v);
      audio.play(v.events, v.ship);
      audio.ambience(v.wind.speed + 6 * v.seaState, v.ship.speed); // a rough sea is louder than the wind alone
      audio.condition(v.ship);
      if (perf) {
        frames++;
        const now = performance.now();
        if (now - last > 500) {
          fps = Math.round((frames * 1000) / (now - last));
          frames = 0;
          last = now;
        }
        Object.assign(window, { __perf: { fps, quality: store.get().graphics.water, frameMs: Math.round(autoQuality.frameMs * 10) / 10, ...view.stats(), crew: v.crew.length, others: v.others.length } });
      }
      if (updated) {
        input.endFrame(); // keep unconsumed presses if no update ran this frame
        updated = false;
        stepTaken = false;
        interactTaken = false;
        fireTaken = false;
      }
    },
    dispose(): void {
      unsubscribe();
      settingsUI.dispose();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
      if (import.meta.env.DEV) delete (window as unknown as { __game?: typeof game }).__game;
      input.dispose();
      hud.dispose();
      map.dispose();
      portPanel.dispose();
      audio.dispose();
      view.dispose(); // also disposes the ambient ships it was given
      ship.dispose();
      for (const es of enemyShips.values()) es.dispose();
      enemyShips.clear();
    },
  };
}
