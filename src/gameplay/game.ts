import { stepCrashes } from './crashes';
import { CONFIG, createRng } from '../core';
import type { Controls, GameEvent, GameView } from '../core';
import { getDeck, type ShipSpec } from '../ships';
import { DEFAULT_CLOCK, PORTS, getPort, hourAt, seaAmp, startHourFor, terrainHeight, waveHeight, type ClockSettings, type Port, type Weather, type WeatherOverrides } from '../world';
import { createExploration } from './exploration';
import { COMBAT, ballHitZone, ballSpeed, cannonsPerSide, fireBroadside, hitNormal, ricochet, stepBall, windVelocity, type Ball, type Side } from './combat';
import { stepAffliction, strike } from './damage';
import { ballViews, enemyView, playerView, portView } from './enemyView';
import { MAX_ENEMIES, aiStep, createEnemy, desiredEnemies, findSpawn, lostTrack, pickEnemySpec, type Enemy } from './enemy';
import { gunScatter, seaEffects, stepBody } from './buoyancy';
import { createCrew, crewCountFor } from './crew';
import { createDevHooks } from './devHooks';
import { createNpcFleet } from './npcShips';
import { createWeatherState } from './weatherState';
import { createPlayerShip, stepPlayerShip, type PlayerShip } from './sailing';

export interface Game {
  readonly spec: ShipSpec;
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
    /** Force the sea state, 0 (glassy) … 1 (storm); `null` returns to the weather. */
    setSea(state: number | null): void;
  };
}

/** Docking needs the ship this close to the anchorage and this slow. */
export const DOCK = { range: 80, maxSpeed: 2.5 } as const;
const START_PORT = 'douwesen';
/** Start this far off the anchorage, facing open water. */
const START_OFFSET = 70;
/** A replacement comes this many seconds after a kill or an escape. */
const RESPAWN = 25;
/** Seconds between one enemy arriving and the next of a group. */
const STAGGER = 12;
/** Nations the enemies sail for, in turn: until factions arrive (5e) everyone is hostile. */
const ENEMY_NATIONS = ['pirate', 'spanish', 'french', 'english', 'dutch'] as const;
/** Fraction of hull strength a moored ship repairs per second. */
const REPAIR_RATE = 0.02;
/** Sub-steps per frame for the cannonballs. */
const BALL_STEPS = 3;

/** Open-sea sandbox: one player ship, an archipelago with ports, and an enemy hunting you. */
export function createGame(spec: ShipSpec): Game {
  const start = getPort(START_PORT) ?? PORTS[0];
  if (!start) throw new Error('no ports defined');
  const rng = createRng(0x5eed);
  const maxHp = spec.stats.hp;

  const makeShip = (): ReturnType<typeof createPlayerShip> =>
    createPlayerShip(
      start.anchor.x + Math.cos(start.outward) * START_OFFSET,
      start.anchor.z + Math.sin(start.outward) * START_OFFSET,
      -start.outward, // forward (cos ψ, -sin ψ) along the outward direction
    );

  let ship = makeShip();
  let hp = maxHp;
  const reload = { port: 0, starboard: 0 };
  let sunk = false;
  let sinkTime = 0;
  let restartAsked = false;
  let kills = 0;
  let time = 0;
  const weatherState = createWeatherState();
  let weather: Weather = weatherState.update(time, 0, ship);
  let wind = { from: weather.windFrom, speed: weather.windSpeed };
  let clock: ClockSettings = { ...DEFAULT_CLOCK };
  let sea = weather.seaState; // how rough the sea is this step
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

  const explore = createExploration(() => ship);
  const nearest = explore.nearest;
  const canDock = (distance: number): boolean => distance <= DOCK.range && Math.abs(ship.speed) <= DOCK.maxSpeed;

  const toggleDock = (): void => {
    if (dockedAt) {
      dockedAt = null;
      ship.docked = false;
      return;
    }
    const n = nearest();
    if (n && canDock(n.distance)) {
      dockedAt = n.port;
      ship.docked = true;
      ship.speed = 0;
    }
  };

  // --- enemies -----------------------------------------------------------------------------
  const spawnEnemy = (): void => {
    const enemySpec = pickEnemySpec(spec, enemyCounter % MAX_ENEMIES); // a squadron of up to three different types
    const at = findSpawn(ship, enemySpec, rng, enemies.filter((e) => e.sinking < 0).map((e) => e.ship));
    if (!at) return; // no room right now: the caller tries again after STAGGER
    const nation = ENEMY_NATIONS[enemyCounter % ENEMY_NATIONS.length];
    enemies.push(createEnemy(`e${++enemyCounter}`, enemySpec, at.x, at.z, at.angle + Math.PI, nation));
  };

  const reset = (): void => {
    ship = makeShip();
    hp = maxHp;
    reload.port = 0;
    reload.starboard = 0;
    sunk = false;
    sinkTime = 0;
    restartAsked = false;
    kills = 0;
    dockedAt = null;
    enemies = [];
    enemyCounter = 0; // a fresh run starts with the closest match and the first nation again
    balls = [];
    events = [];
    respawnIn = 0;
    spawnEnemy();
  };

  // --- combat ------------------------------------------------------------------------------
  const fire = (owner: 'player' | 'enemy', hull: PlayerShip, s: ShipSpec, side: Side): void => {
    // A hull rolling in a rough sea shoots wider.
    const spread = (owner === 'enemy' ? COMBAT.enemySpread : 1) * gunScatter(hull.body, sea);
    const shot = fireBroadside(owner, hull, s, side, rng, () => ++ballCounter, spread);
    balls.push(...shot.balls);
    events.push(...shot.events);
  };

  const checkPlayerSunk = (): void => {
    if (hp > 0 || sunk) return;
    sunk = true;
    sinkTime = 0;
    events.push({ type: 'sunk', owner: 'player', x: ship.x, y: 0, z: ship.z });
  };

  const checkEnemySunk = (e: Enemy): void => {
    if (e.hp > 0 || e.sinking >= 0) return;
    e.sinking = 0;
    kills++;
    respawnIn = RESPAWN;
    events.push({ type: 'sunk', owner: 'enemy', x: e.ship.x, y: 0, z: e.ship.z });
  };

  /** One ball's step against ships, shore and sea: true when it is spent (hit, sunk, on land). */
  const resolveBall = (b: Ball): boolean => {
    if (b.owner === 'enemy') {
      // A moored ship is safe in the harbour.
      const zone = !sunk && !dockedAt ? ballHitZone(b, ship, spec) : null;
      if (zone) {
        const lost = strike(ship, zone, b.damage, maxHp, rng());
        hp = Math.max(0, hp - lost);
        const n = hitNormal(b, ship);
        events.push({ type: 'hit', owner: 'enemy', x: b.x, y: b.y, z: b.z, amount: lost, zone, nx: n.x, nz: n.z, speed: ballSpeed(b) });
        checkPlayerSunk();
        return true;
      }
    } else {
      for (const e of enemies) {
        const zone = e.sinking < 0 ? ballHitZone(b, e.ship, e.spec) : null;
        if (!zone) continue;
        const lost = strike(e.ship, zone, b.damage, e.maxHp, rng());
        e.hp = Math.max(0, e.hp - lost);
        const n = hitNormal(b, e.ship);
        events.push({ type: 'hit', owner: 'player', x: b.x, y: b.y, z: b.z, amount: lost, zone, nx: n.x, nz: n.z, speed: ballSpeed(b) });
        checkEnemySunk(e);
        return true;
      }
    }
    const ground = terrainHeight(b.x, b.z);
    if (ground > b.y) {
      events.push({ type: 'splash', owner: b.owner, x: b.x, y: Math.max(0, ground), z: b.z, speed: ballSpeed(b) });
      return true;
    }
    if (b.y > 4) return false;
    const surface = waveHeight(b.x, b.z, time, wind.from, seaAmp(sea), 0, weather.tuning);
    if (b.y > surface) return false;
    const skipped = ricochet(b, surface);
    events.push({ type: 'splash', owner: b.owner, x: b.x, y: surface, z: b.z, speed: ballSpeed(b), amount: skipped ? 0 : undefined });
    return !skipped;
  };

  /** Fly the balls: three sub-steps a frame (a ball moves 1.5 m a step, narrow targets are not skipped), drag and wind included. */
  const stepBalls = (dt: number): void => {
    const air = windVelocity(wind);
    const alive: Ball[] = [];
    for (const b of balls) {
      let spent = false;
      for (let k = 0; k < BALL_STEPS && !spent; k++) {
        stepBall(b, dt / BALL_STEPS, air);
        spent = resolveBall(b);
      }
      if (!spent && b.age < COMBAT.maxAge) alive.push(b);
    }
    balls = alive;
  };

  const stepEnemies = (dt: number): void => {
    for (const e of enemies) {
      if (e.sinking >= 0) {
        e.sinking += dt;
        e.ship.speed *= 1 - 0.5 * dt;
        continue;
      }
      const ai = aiStep(e, ship, wind, enemies.filter((o) => o !== e && o.sinking < 0).map((o) => o.ship));
      stepPlayerShip(e.ship, e.spec, wind, ai.controls, dt, seaEffects(e.spec, e.ship.heading, wind.from, sea));
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
        fire('enemy', e.ship, e.spec, ai.fire);
        e.reload[ai.fire] = COMBAT.enemyReload;
      }
    }
    enemies = enemies.filter((e) => !e.gone && e.sinking < CONFIG.sinkSeconds);
    if (!sunk && respawnIn > 0) respawnIn -= dt;
    if (!sunk && respawnIn <= 0 && enemies.filter((e) => e.sinking < 0).length < desiredEnemies(kills)) {
      spawnEnemy();
      respawnIn = STAGGER;
    }
  };

  reset();
  explore.discover();

  return {
    spec,
    dev: createDevHooks({
      ship: () => ship,
      enemies: () => enemies,
      setKills: (n) => (kills = n),
      setSea: (state) => weatherState.patch({ seaState: state === null ? undefined : state }),
      discover: () => explore.discover(),
    }),
    setWeather: (change) => weatherState.patch(change),
    setClock({ hour, ...rest }): void {
      const now = hourAt(time, clock); // keep the time of day when only the speed changes
      clock = { ...clock, ...rest };
      clock.startHour = startHourFor(hour ?? now, time, clock);
    },
    update(dt, controls): void {
      time += dt;
      weather = weatherState.update(time, dt, ship);
      wind = { from: weather.windFrom, speed: weather.windSpeed };
      sea = weather.seaState;
      if (sunk) {
        sinkTime += dt;
        ship.speed *= 1 - 0.4 * dt;
        stepBody(ship.body, ship, spec, time, wind.from, sea, dt, false, weather.tuning);
        stepBalls(dt);
        // A restart asked for during the first moments of sinking is honoured once the screen shows.
        if (controls.restart) restartAsked = true;
        if (restartAsked && sinkTime > 2) reset();
        return;
      }
      if (controls.interact) toggleDock();
      stepPlayerShip(ship, spec, wind, controls, dt, seaEffects(spec, ship.heading, wind.from, sea));
      stepBody(ship.body, ship, spec, time, wind.from, sea, dt, !!dockedAt, weather.tuning);
      crew?.update(dt);
      npcs.update(dt);

      reload.port = Math.max(0, reload.port - dt);
      reload.starboard = Math.max(0, reload.starboard - dt);
      const side: Side | null = controls.firePort ? 'port' : controls.fireStarboard ? 'starboard' : null;
      if (side && !dockedAt && reload[side] <= 0 && cannonsPerSide(spec) > 0) {
        fire('player', ship, spec, side);
        reload[side] = COMBAT.playerReload;
      }
      if (dockedAt) hp = Math.min(maxHp, hp + maxHp * REPAIR_RATE * dt);
      hp = Math.max(0, hp - stepAffliction(ship, maxHp, !!dockedAt, dt));
      checkPlayerSunk();

      stepEnemies(dt);
      // Ships that share the sea run into each other.
      const crash = stepCrashes({ ship, spec, maxHp, active: !dockedAt && !sunk }, enemies, npcs.view());
      events.push(...crash.events);
      crash.apply(
        (lost) => ((hp = Math.max(0, hp - lost)), checkPlayerSunk()),
        (e, lost) => ((e.hp = Math.max(0, e.hp - lost)), checkEnemySunk(e)),
      );
      stepBalls(dt);
      explore.discover();
    },

    view(): GameView {
      const n = nearest();
      const nearestPort = n && portView(n, ship, !dockedAt && canDock(n.distance));
      const enemyViews = enemies.map((e) => enemyView(e, ship));
      const afloat = enemies.filter((e) => e.sinking < 0);
      const drained = events;
      events = [];
      return {
        time,
        wind,
        hour: hourAt(time, clock),
        weather: weatherState.view(weather),
        seaState: sea,
        others: npcs.view(),
        crew: crew?.view() ?? [],
        ship: playerView(ship, spec, { hp, maxHp, reload }, afloat),
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
        kills,
      };
    },
  };
}
