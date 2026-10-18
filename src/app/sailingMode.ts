import { createAudio } from '../audio';
import { createInput, type Controls, type GameView } from '../core';
import { createGame, type GameState, type SaveStore, type SlotId } from '../gameplay';
import { createAutoQuality, createSailingView, lowerQuality, nextQuality } from '../render';
import { getSettings } from '../settings';
import { createShip, getShipSpec, requestShipAsset, type Ship, type ShipLod, type ShipSpec } from '../ships';
import { createHud, createMapUi, createPortPanel, createSettingsUI, reasonText, saveTab, weatherTab } from '../ui';
import { getNation, sunState, weatherAt, type Weather } from '../world';
import { gameLines, renderLines } from './debugLines';
import { describeSave, whyNoSave } from './saves';
import { SLOW_REASONS, effectiveSpeed, stepSpeed } from './timeScale';
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
const BOARD = 'KeyB';
const MAP = 'KeyM';
const AIM = 'KeyG';
const GUNS_UP = 'KeyX'; // longer range
const GUNS_DOWN = 'KeyZ'; // shorter range
const MUTE = 'KeyN';
const QUALITY = 'KeyK';
/** Game speed keys are matched by the character they type (+ = and - _, on the numpad too), so every keyboard layout works. */
const FASTER = ['+', '='];
const SLOWER = ['-', '_'];
const GAME_KEYS = [...PORT, ...STARBOARD, ...MORE_SAIL, ...LESS_SAIL];

/** The weather in a view, as the weather simulator's panel reads it. */
const weatherOf = (v: GameView): Weather => ({
  windSpeed: v.wind.speed,
  windFrom: v.wind.from,
  seaState: v.seaState,
  cloud: v.weather.cloud,
  fog: v.weather.fog,
  rain: v.weather.rain,
  lightning: v.weather.lightning,
  tuning: v.weather.tuning,
});

/** Seconds of game time between automatic saves at sea (the game also saves on docking). */
const AUTOSAVE_SECONDS = 60;

/**
 * Free sailing on the open sea with the chosen ship, or the run in a saved state. Esc opens the settings menu, which has
 * the way back (`onExit`) and the save tab (`onLoad` restarts the mode on the saved run).
 */
export function startSailingMode(host: HTMLElement, init: ShipSpec | GameState, onExit: () => void, saves: SaveStore, onLoad: (state: GameState) => void): Mode {
  const input = createInput();
  const game = createGame(init);
  const spec = game.spec;
  // In dev, expose the game on window so it can be poked from the browser console (e.g. __game.dev.setKills(4)).
  if (import.meta.env.DEV) (window as unknown as { __game?: typeof game }).__game = game;
  let ship = createShip(spec, { flag: getNation('free').flag, ensign: 'free' }); // the player is a free captain
  let shipId = spec.id;
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
  let buying = false;
  const portPanel = createPortPanel(host, (cmd) => {
    if (cmd.type !== 'buyShip') return game.command(cmd);
    // A new ship: check the offer, then have its model (and deck) loaded before the game swaps it in.
    const offer = lastView?.port?.shipyard.offers.find((o) => o.specId === cmd.specId);
    if (!offer || offer.reason) return { ok: false, reason: offer?.reason ?? 'not-sold' };
    if (buying) return { ok: false, reason: 'busy' };
    buying = true;
    void requestShipAsset(cmd.specId).finally(() => {
      buying = false;
      const r = game.command(cmd); // the world moved on while the model loaded: say so if the purchase no longer works
      hud.notice(r.ok ? `Yeni gemi: ${getShipSpec(cmd.specId)?.name ?? ''}` : reasonText(r));
    });
    return { ok: true };
  });
  const audio = createAudio();
  let paused = false;
  let lastView: GameView | null = null;
  let lastStrike = game.view().weather.strike?.id ?? 0; // a strike from before this mode started is not heard again
  /** Write the run to a slot (the autosave by default); false when the run may not be saved now or storage refuses. */
  const writeSave = (slot: SlotId = 'auto'): boolean => !whyNoSave(lastView) && saves.save(game.state(), new Date().toISOString(), slot);
  let lastSaveAt = game.view().time;
  let lastDocked: string | null = null;
  const settingsUI = createSettingsUI(host, store, {
    onExit: { label: 'Galeriye dön', run: onExit },
    onOpenChange: (open) => (paused = open),
    extraTabs: [
      saveTab({
        slots: () => saves.slots().map(({ slot, result }) => ({ slot, label: slot === 'auto' ? 'Otomatik' : `Kayıt ${slot}`, info: describeSave(result), canLoad: result.ok, canSave: slot !== 'auto' })),
        save: (slot) => whyNoSave(lastView) ?? (writeSave(slot as SlotId) ? 'Kaydedildi.' : 'Kaydedilemedi (tarayıcı depolamayı engelliyor).'),
        load: (slot) => {
          const r = saves.load(slot as SlotId);
          if (!r.ok) return 'Yüklenecek geçerli bir kayıt yok.';
          onLoad(r.state);
          return '';
        },
      }),
      weatherTab({
        hour: () => lastView?.hour ?? 9,
        setHour: (h) => game.setClock({ hour: h }),
        weather: () => (lastView ? weatherOf(lastView) : weatherAt(0)),
        setWeather: (change) => game.setWeather(change),
      }),
    ],
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
  /** The speed the player asked for with + and -; `effectiveSpeed` may hold the game at 1× while it is dangerous. */
  let speedRequest = 1;
  // Ambient ships come from the game view; build their models the first time they appear.
  const npcs: Ship[] = [];
  const syncOthers = (v: GameView): void => {
    if (npcs.length === v.others.length) return;
    for (const o of v.others.slice(npcs.length)) {
      // Always push one ship per entry so ship i keeps matching others[i].
      npcs.push(createShip(getShipSpec(o.specId) ?? spec, { flag: getNation(o.nation ?? 'free').flag, ensign: o.nation ?? 'free' }));
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
    else if ((FASTER.includes(e.key) || SLOWER.includes(e.key)) && !e.repeat) {
      speedRequest = stepSpeed(speedRequest, FASTER.includes(e.key) ? 1 : -1);
      hud.notice(`Oyun hızı: ${speedRequest}×`);
    } else if (e.code === QUALITY && !e.repeat) {
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
  let boardTaken = false;

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
    const elevate = ((input.isDown(GUNS_UP) ? 1 : 0) - (input.isDown(GUNS_DOWN) ? 1 : 0)) as -1 | 0 | 1;
    const board = !boardTaken && input.pressed(BOARD);
    if (board) boardTaken = true;
    return { rudder, sailStep, interact, firePort, fireStarboard, elevate, board, restart: input.pressed(RESTART) };
  };

  /** The captain bought another ship: draw it in place of the old one. */
  const swapPlayer = (id: string): void => {
    const next = getShipSpec(id);
    if (!next) return;
    const old = ship;
    ship = createShip(next, { flag: getNation('free').flag, ensign: 'free' });
    shipId = id;
    view.setPlayer(ship.root, { length: next.length, beam: next.beam });
    old.dispose();
    hud.setShipName(next.name);
  };

  const syncEnemies = (v: ReturnType<typeof game.view>): void => {
    const live = new Set<string>();
    for (const e of [...v.enemies, ...v.consorts]) {
      live.add(e.id);
      let es = enemyShips.get(e.id);
      if (!es) {
        const enemySpec = getShipSpec(e.specId);
        if (!enemySpec) continue;
        es = createShip(enemySpec, { flag: getNation(e.nation).flag, ensign: e.nation });
        enemyShips.set(e.id, es);
        view.addActor(e.id, es.root, { length: enemySpec.length, beam: enemySpec.beam });
      }
      es.setSailTrim(e.apparent.angle, e.sailLevel);
      es.setWind?.({ angle: e.apparent.angle, speed: e.apparent.speed, gust: 1 });
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
      const c = controls();
      const { speed } = effectiveSpeed(speedRequest, lastView);
      game.update(dt, c);
      // Faster than 1x: more steps of the same size, the one-shot presses acted in the first
      for (let k = 1; k < speed; k++) game.update(dt, { rudder: c.rudder, sailStep: 0, elevate: c.elevate });
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
      if (v.weather.strike && v.weather.strike.id !== lastStrike) {
        lastStrike = v.weather.strike.id;
        audio.thunder(Math.hypot(v.weather.strike.x - v.ship.x, v.weather.strike.z - v.ship.z), v.weather.strike.power);
      }
      if (v.ship.specId !== shipId) swapPlayer(v.ship.specId);
      // Autosave: whenever the ship moors, and every minute at sea.
      if ((v.docked && v.docked !== lastDocked) || v.time - lastSaveAt >= AUTOSAVE_SECONDS) {
        if (writeSave()) {
          lastSaveAt = v.time;
          hud.notice('Kaydedildi');
        } else lastSaveAt = v.time - AUTOSAVE_SECONDS + 5; // not now (a fight, a blocked store): try again in 5 s
      }
      lastDocked = v.docked;
      syncOthers(v);
      ship.setSailTrim(v.ship.apparent.angle, v.ship.sailLevel);
      ship.setWind?.({ angle: v.ship.apparent.angle, speed: v.ship.apparent.speed, gust: v.ship.gust });
      ship.setCondition(v.ship, v.time);
      syncEnemies(v);
      view.draw(v);
      hud.update(v);
      const slowed = effectiveSpeed(speedRequest, v);
      hud.setTimeScale(slowed.speed, slowed.reason ? SLOW_REASONS[slowed.reason] : null);
      map.update(v);
      portPanel.update(v);
      for (const e of v.events) if (e.type === 'quest' && e.text) hud.notice(e.text); // errands settled on mooring
      audio.play(v.events, v.ship);
      audio.ambience(v.wind.speed + 6 * v.seaState, v.ship.speed); // a rough sea is louder than the wind alone
      audio.condition(v.ship);
      audio.mood({ sea: v.seaState, day: sunState(v.hour).daylight, docked: v.docked !== null });
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
        boardTaken = false;
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
