import { stepCrashes } from './crashes';
import { CONFIG, createRng } from '../core';
import type { Controls, GameEvent, GameView, WindView } from '../core';
import { getDeck, getShipSpec, type ShipSpec } from '../ships';
import { DEFAULT_CLOCK, gustAt, hourAt, seaAmp, waveHeight, type ClockSettings, type Port, type Weather, type WeatherOverrides } from '../world';
import { createExploration } from './exploration';
import { COMBAT, ELEVATION, cannonsPerSide, windVelocity, type Ball, type Side } from './combat';
import { planBroadside } from './gunnery';
import { createSalvo } from './salvo';
import { flyBalls, type ShotWorld } from './shots';
import { stepAffliction } from './damage';
import { ballViews, enemyView, playerView, portView } from './enemyView';
import { aiStep, desiredEnemies, lostTrack, spawnFor, type Enemy } from './enemy';
import { gunScatter, seaEffects, stepBody } from './buoyancy';
import { createCrew, crewCountFor } from './crew';
import { createDevHooks } from './devHooks';
import { createNpcFleet } from './npcShips';
import { createWeatherState } from './weatherState';
import { createPlayerShip, stepPlayerShip, type PlayerShip } from './sailing';
import { cloneState, newGameState, startPose, type GameState } from './state';
import { DOCK, ELEVATE_RATE, REPAIR_RATE, RESPAWN, STAGGER } from './tuning';
import { restoreShip, boardingView, captainView, cargoView, companyView, snapshot } from './stateView';
import { changeClock } from './clockState';
import { createDesk } from './desk';
import { awardXp, killXp } from './plunder';

export interface Game {
  /** The ship the player sails now. */
  readonly spec: ShipSpec;
  /** A copy of everything a save needs (see `GameState`). */
  state(): GameState;
  update(dt: number, controls: Controls): void;
  /** Take over parts of the weather (the weather simulator): see `WeatherOverrides`; `null` gives it all back to the game. */
  setWeather(change: WeatherOverrides | null): void;
  /** The day's clock: how long a day lasts, whether time stands still, and (`hour`) what time it is now. */
  setClock(clock: Partial<Pick<ClockSettings, 'dayMinutes' | 'frozen'>> & { hour?: number }): void;
  /** Snapshot for render and UI. Drains `events`, so call it once per frame. */
  view(): GameView;
  /** Hooks for tests and for poking at the game from the browser console in dev; the game never calls them. */
  readonly dev: {
    /** Set every live enemy's hull to this fraction of its maximum. */
    damageEnemies(fraction: number): void;
    /** Move the player's ship (it keeps heading and speed). */
    teleportPlayer(x: number, z: number): void;
    /** Pretend this many enemies have been sunk: changes how many attack at once. */
    setKills(n: number): void;
    /** Set the player's rigging health, 0…1. */
    setRigging(fraction: number): void;
    /** Set the player's flooding and fire, 0…1. */
    setAffliction(flooding: number, fire: number): void;
    /** Set the captain's gold, the crew count, or add experience. */
    setGold(n: number): void;
    setCrew(n: number): void;
    addXp(n: number): void;
    /** Force the sea state, 0 (glassy) … 1 (storm); `null` returns to the weather. */
    setSea(state: number | null): void;
  };
}

/** Open-sea sandbox: one player ship, an archipelago with ports, and an enemy hunting you. */
export function createGame(init: ShipSpec | GameState): Game {
  const st: GameState = cloneState('ship' in init ? init : newGameState(init));
  const spec: ShipSpec = 'ship' in init ? (getShipSpec(init.ship.specId) ?? fail(`unknown ship ${init.ship.specId}`)) : init;
  const rng = createRng(0x5eed);
  const maxHp = spec.stats.hp;

  const makeShip = (pose: GameState['pose']): PlayerShip => createPlayerShip(pose.x, pose.z, pose.heading);

  let ship = makeShip(st.pose);
  let hp = Math.min(maxHp, Math.max(1, st.ship.hp));
  const reload = { port: 0, starboard: 0 };
  const salvo = createSalvo();
  let elevation: number = ELEVATION.rest; // how high the player's guns are laid (rad)
  let sunk = false;
  let sinkTime = 0;
  let restartAsked = false;
  let threat = 0; // ships sunk this run: how many enemies attack at once (the career count is `st.captain.kills`)
  let time = st.time;
  const desk = createDesk(st, () => spec);
  const weatherState = createWeatherState();
  let weather: Weather = weatherState.update(time, 0, ship);
  let wind = { from: weather.windFrom, speed: weather.windSpeed };
  let clock: ClockSettings = { ...DEFAULT_CLOCK };
  let sea = weather.seaState; // how rough the sea is this step
  /** The wind a ship at a place feels now: the true wind in the gust over it. */
  const feel = (s: { x: number; z: number }): WindView => ({ from: wind.from, speed: wind.speed * gustAt(s.x, s.z, time, wind) });
  const deck = getDeck(spec.id); // only ships with a walkable GLB deck carry a visible crew
  const crew = deck ? createCrew(deck, crewCountFor(spec.length)) : null;
  const npcs = createNpcFleet({ x: ship.x, z: ship.z }); // patrols around the start, on open water
  let dockedAt: Port | null = null;

  let enemies: Enemy[] = [];
  let enemyCounter = 0;
  let respawnIn = 0;
  let balls: Ball[] = [];
  let ballCounter = 0;
  let events: GameEvent[] = [];

  const explore = createExploration(() => ship, st.discovered);
  const nearest = explore.nearest;
  const canDock = (distance: number): boolean => distance <= DOCK.range && Math.abs(ship.speed) <= DOCK.maxSpeed;

  const toggleDock = (): void => {
    const n = dockedAt ? null : nearest();
    dockedAt = n && canDock(n.distance) ? n.port : null;
    ship.docked = !!dockedAt;
    if (dockedAt) ship.speed = 0;
  };

  // --- enemies -----------------------------------------------------------------------------
  const spawnEnemy = (): void => {
    const next = spawnFor(spec, ship, enemies, enemyCounter, rng);
    if (!next) return; // no room right now: the caller tries again after STAGGER
    enemies.push(next);
    enemyCounter++;
  };

  const reset = (pose: GameState['pose'] = startPose()): void => {
    ship = makeShip(pose);
    hp = maxHp;
    reload.port = 0;
    reload.starboard = 0;
    salvo.clear();
    elevation = ELEVATION.rest;
    sunk = false;
    sinkTime = 0;
    restartAsked = false;
    threat = 0;
    dockedAt = null;
    enemies = [];
    enemyCounter = 0; // a fresh run starts with the closest match and the first nation again
    balls = [];
    events = [];
    respawnIn = 0;
    spawnEnemy();
  };

  // --- combat ------------------------------------------------------------------------------
  /** Order a broadside: the guns ripple off over the next half second (see `salvo.ts`), unless the ship is lost first. */
  const fire = (owner: 'player' | 'enemy', hull: PlayerShip, s: ShipSpec, side: Side, alive: () => boolean, aimed?: number): void => {
    // A hull rolling in a rough sea shoots wider.
    const spread = (owner === 'enemy' ? COMBAT.enemySpread : 1) * gunScatter(hull.body, sea);
    salvo.queue(owner, hull, s, side, planBroadside(s, rng, spread, aimed, true), alive);
  };

  const stepSalvo = (dt: number): void => {
    const out = salvo.step(dt, () => ++ballCounter);
    balls.push(...out.balls);
    events.push(...out.events);
  };

  const checkPlayerSunk = (): void => {
    if (hp > 0 || sunk) return;
    sunk = true;
    sinkTime = 0;
    events.push({ type: 'sunk', owner: 'player', x: ship.x, y: 0, z: ship.z });
  };

  const checkEnemySunk = (e: Enemy, boarded = false): void => {
    if (e.hp > 0 || e.sinking >= 0) return;
    e.sinking = 0;
    awardXp(st, killXp(e, boarded), e.ship, events);
    threat++;
    st.captain.kills++;
    respawnIn = RESPAWN;
    events.push({ type: 'sunk', owner: 'enemy', x: e.ship.x, y: 0, z: e.ship.z });
  };

  /** Fly the balls: three sub-steps a frame (a ball moves 1.5 m a step, narrow targets are not skipped), drag and wind included. */
  const stepBalls = (dt: number): void => {
    const air = windVelocity(wind);
    const world: ShotWorld = {
      player: { ship, spec, maxHp, targetable: !sunk && !dockedAt }, // a moored ship is safe in the harbour
      enemies,
      rng,
      surfaceAt: (x, z) => waveHeight(x, z, time, wind.from, seaAmp(sea), 0, weather.tuning),
      emit: (e) => events.push(e),
      onPlayerHit: (lost, zone) => {
        hp = Math.max(0, hp - lost);
        desk.loseCrew(lost, maxHp, zone);
        checkPlayerSunk();
      },
      onEnemyHit: (e, lost) => {
        e.hp = Math.max(0, e.hp - lost);
        checkEnemySunk(e);
      },
    };
    balls = flyBalls(balls, dt, air, world);
  };

  const stepEnemies = (dt: number): void => {
    for (const e of enemies) {
      if (e.sinking >= 0) {
        e.sinking += dt;
        e.ship.speed *= 1 - 0.5 * dt;
        continue;
      }
      const ai = aiStep(e, ship, wind, enemies.filter((o) => o !== e && o.sinking < 0).map((o) => o.ship));
      stepPlayerShip(e.ship, e.spec, feel(e.ship), ai.controls, dt, seaEffects(e.spec, e.ship.heading, wind.from, sea));
      stepBody(e.ship.body, e.ship, e.spec, time, wind.from, sea, dt, false, weather.tuning);
      e.hp = Math.max(0, e.hp - stepAffliction(e.ship, e.maxHp, false, dt));
      checkEnemySunk(e);
      if (e.sinking >= 0) continue;
      if (lostTrack(e, Math.hypot(e.ship.x - ship.x, e.ship.z - ship.z), dt)) {
        // Out of sight for too long: the enemy gives up (or, damaged, got away).
        e.gone = true;
        events.push({ type: 'escaped', owner: 'enemy', x: e.ship.x, y: 0, z: e.ship.z });
        respawnIn = RESPAWN;
        continue;
      }
      e.reload.port = Math.max(0, e.reload.port - dt);
      e.reload.starboard = Math.max(0, e.reload.starboard - dt);
      if (ai.fire && !sunk && !dockedAt) {
        fire('enemy', e.ship, e.spec, ai.fire, () => e.sinking < 0 && !e.gone);
        e.reload[ai.fire] = COMBAT.enemyReload;
      }
    }
    enemies = enemies.filter((e) => !e.gone && e.sinking < CONFIG.sinkSeconds);
    if (!sunk && respawnIn > 0) respawnIn -= dt;
    if (!sunk && respawnIn <= 0 && enemies.filter((e) => e.sinking < 0).length < desiredEnemies(threat)) {
      spawnEnemy();
      respawnIn = STAGGER;
    }
  };

  reset(st.pose);
  // A loaded run keeps the state its ship was in and may begin moored.
  hp = Math.min(maxHp, Math.max(1, st.ship.hp));
  dockedAt = restoreShip(ship, st);
  explore.discover();

  return {
    get spec(): ShipSpec {
      return spec;
    },
    state(): GameState {
      return snapshot(st, { spec, hp, ship, dockedAt: dockedAt?.id ?? null, islands: explore.islands(), ports: explore.ports(), time });
    },
    dev: createDevHooks({
      ship: () => ship,
      enemies: () => enemies,
      setKills: (n) => (threat = n),
      setSea: (state) => weatherState.patch({ seaState: state === null ? undefined : state }),
      discover: () => explore.discover(),
      state: () => st,
    }),
    setWeather: (change) => weatherState.patch(change),
    setClock: (change) => (clock = changeClock(clock, change, time)),
    update(dt, controls): void {
      time += dt;
      weather = weatherState.update(time, dt, ship);
      wind = { from: weather.windFrom, speed: weather.windSpeed };
      sea = weather.seaState;
      if (sunk) {
        sinkTime += dt;
        ship.speed *= 1 - 0.4 * dt;
        stepBody(ship.body, ship, spec, time, wind.from, sea, dt, false, weather.tuning);
        stepSalvo(dt);
        stepBalls(dt);
        // A restart asked for during the first moments of sinking is honoured once the screen shows.
        if (controls.restart) restartAsked = true;
        if (restartAsked && sinkTime > 2) {
          desk.sunkPenalty();
          reset();
        }
        return;
      }
      if (controls.interact) toggleDock();
      desk.tick(dt);
      if (controls.board && !dockedAt) {
        const prize = desk.attempt(ship, enemies, rng, events);
        if (prize) {
          prize.hp = 0;
          checkEnemySunk(prize, true); // the prize is scuttled: it goes down with a kill's experience (and the boarding bonus)
        }
      }
      stepPlayerShip(ship, spec, feel(ship), controls, dt, seaEffects(spec, ship.heading, wind.from, sea));
      stepBody(ship.body, ship, spec, time, wind.from, sea, dt, !!dockedAt, weather.tuning);
      crew?.update(dt);
      npcs.update(dt);

      reload.port = Math.max(0, reload.port - dt);
      reload.starboard = Math.max(0, reload.starboard - dt);
      elevation = Math.min(ELEVATION.max, Math.max(ELEVATION.min, elevation + (controls.elevate ?? 0) * ELEVATE_RATE * dt));
      const side: Side | null = controls.firePort ? 'port' : controls.fireStarboard ? 'starboard' : null;
      if (side && !dockedAt && reload[side] <= 0 && cannonsPerSide(spec) > 0) {
        fire('player', ship, spec, side, () => !sunk, elevation);
        reload[side] = desk.reloadSeconds();
      }
      if (dockedAt) hp = Math.min(maxHp, hp + maxHp * REPAIR_RATE * dt);
      hp = Math.max(0, hp - stepAffliction(ship, maxHp, !!dockedAt, dt));
      checkPlayerSunk();

      stepEnemies(dt);
      // Ships that share the sea run into each other.
      const crash = stepCrashes({ ship, spec, maxHp, active: !dockedAt && !sunk }, enemies, npcs.view(wind), (id, dx, dz, dyaw) => npcs.nudge(id, dx, dz, dyaw));
      events.push(...crash.events);
      crash.apply(
        (lost) => ((hp = Math.max(0, hp - lost)), desk.loseCrew(lost, maxHp, 'hull'), checkPlayerSunk()),
        (e, lost) => ((e.hp = Math.max(0, e.hp - lost)), checkEnemySunk(e)),
      );
      stepSalvo(dt);
      stepBalls(dt);
      explore.discover();
    },

    view(): GameView {
      const n = nearest();
      const nearestPort = n && portView(n, ship, !dockedAt && canDock(n.distance));
      const enemyViews = enemies.map((e) => enemyView(e, ship, feel(e.ship)));
      const afloat = enemies.filter((e) => e.sinking < 0);
      const drained = events;
      events = [];
      return {
        time,
        wind,
        hour: hourAt(time, clock),
        weather: weatherState.view(weather),
        seaState: sea,
        others: npcs.view(wind),
        crew: crew?.view() ?? [],
        captain: captainView(st),
        cargo: cargoView(st, spec),
        company: companyView(st, spec),
        boarding: boardingView(st, dockedAt || sunk ? null : desk.prize(ship, enemies), desk.cooldown()),
        ship: playerView(ship, spec, { hp, maxHp, reloadSeconds: desk.reloadSeconds(), reload, elevation, air: windVelocity(wind), wind: feel(ship), gust: gustAt(ship.x, ship.z, time, wind), armed: !dockedAt && !sunk }, afloat),
        nearestPort,
        docked: dockedAt?.id ?? null,
        grounded: ship.grounded > 0,
        discoveredIslands: explore.islands(),
        discoveredPorts: explore.ports(),
        enemies: enemyViews,
        balls: ballViews(balls),
        events: drained,
        sunk,
        sinkTime,
        kills: threat,
      };
    },
  };
}

function fail(message: string): never {
  throw new Error(message);
}
