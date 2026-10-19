import { stepCrashes } from './crashes';
import type { Game } from './gameApi';
import { createRng } from '../core';
import type { CommandResult, Controls, GameEvent, GameView, WindView } from '../core';
import { getDeck, getShipSpec, type ShipSpec } from '../ships';
import { DEFAULT_CLOCK, gustAt, hourAt, insidePortZone, seaAmp, waveHeight, type ClockSettings, type Port, type Weather } from '../world';
import { createExploration } from './exploration';
import { COMBAT, ELEVATION, cannonsPerSide, windVelocity, type Ball, type Side } from './combat';
import { planBroadside } from './gunnery';
import { createSalvo } from './salvo';
import { flyBalls, type ShotWorld } from './shots';
import { stepAffliction } from './damage';
import { ballViews, playerView, portView } from './enemyView';
import type { Enemy } from './enemy';
import { createEnemyDirector } from './enemyDirector';
import { gunScatter, seaEffects, stepBody } from './buoyancy';
import { createCrew, crewCountFor } from './crew';
import { crewLayout } from './crewLayout';
import { createShipCrews } from './shipCrews';
import { shipViews } from './shipViews';
import { createMerchantBook, plunderMerchant } from './merchants';
import { createDevHooks } from './devHooks';
import { createNpcFleet } from './npcShips';
import { createWeatherState } from './weatherState';
import { createPlayerShip, stepPlayerShip, type PlayerShip } from './sailing';
import { cloneState, holdUsed, newGameState, startPose, type GameState } from './state';
import { DOCK, ELEVATE_RATE, REPAIR_RATE } from './tuning';
import { restoreShip, boardingView, captainView, cargoView, companyView, snapshot } from './stateView';
import { runCommand, servicesView } from './harbour';
import { runYard } from './shipyard';
import { runFleetYard } from './fleetYard';
import { createFleetDirector } from './fleetDirector';
import { fadeStanding, portClosed } from './reputation';
import { settleQuests } from './quests';
import { changeClock } from './clockState';
import { COMPANY } from './company';
import { createDesk } from './desk';

/** Open-sea sandbox: one player ship, an archipelago with ports, and an enemy hunting you. */
export function createGame(init: ShipSpec | GameState): Game {
  const st: GameState = cloneState('ship' in init ? init : newGameState(init));
  let spec: ShipSpec = 'ship' in init ? (getShipSpec(init.ship.specId) ?? fail(`unknown ship ${init.ship.specId}`)) : init;
  const rng = createRng(0x5eed);
  let maxHp = spec.stats.hp;

  const makeShip = (pose: GameState['pose']): PlayerShip => createPlayerShip(pose.x, pose.z, pose.heading);

  let ship = makeShip(st.pose);
  let hp = Math.min(maxHp, Math.max(1, st.ship.hp));
  const reload = { port: 0, starboard: 0 };
  const salvo = createSalvo();
  let elevation: number = ELEVATION.rest; // how high the player's guns are laid (rad)
  let sunk = false;
  let sinkTime = 0;
  let restartAsked = false;
  let time = st.time;
  const desk = createDesk(st, () => spec);
  const weatherState = createWeatherState();
  let weather: Weather = weatherState.update(time, 0, ship);
  let wind = { from: weather.windFrom, speed: weather.windSpeed };
  let clock: ClockSettings = { ...DEFAULT_CLOCK };
  let sea = weather.seaState; // how rough the sea is this step
  /** The wind a ship at a place feels now: the true wind in the gust over it. */
  const feel = (s: { x: number; z: number }): WindView => ({ from: wind.from, speed: wind.speed * gustAt(s.x, s.z, time, wind) });
  const crewFor = (s: ShipSpec): ReturnType<typeof createCrew> | null => {
    const deck = getDeck(s.id); // only ships with a walkable GLB deck carry a visible crew
    return deck ? createCrew(deck, crewCountFor(s.length), 1, crewLayout(s, deck)) : null;
  };
  let crew = crewFor(spec);
  const shipCrews = createShipCrews(); // the sailors of the ships nearby, for show
  const npcs = createNpcFleet({ x: ship.x, z: ship.z }); // patrols around the start, on open water
  const merchants = createMerchantBook(npcs.firstMerchantId); // the traders can be shot at, sunk and plundered
  let others = npcs.view(wind, []); // the other ships as of the last step
  let dockedAt: Port | null = null;

  let balls: Ball[] = [];
  let ballCounter = 0;
  let events: GameEvent[] = [];

  const explore = createExploration(() => ship, st.discovered);
  const nearest = explore.nearest;
  /** In the marked entry zone of the port, and slow enough. */
  const canDock = (port: Port): boolean => insidePortZone(port, ship.x, ship.z) && Math.abs(ship.speed) <= DOCK.maxSpeed && !portClosed(st, port);
  const repClock = { t: 0 }; // standing fades with time

  const toggleDock = (): void => {
    const wasDocked = !!dockedAt;
    const n = dockedAt ? null : nearest();
    dockedAt = n && canDock(n.port) ? n.port : null;
    ship.docked = !!dockedAt;
    if (dockedAt) {
      ship.speed = 0;
      st.crew = Math.max(st.crew, Math.ceil(spec.stats.crew * COMPANY.volunteers));
      if (!wasDocked) {
        fleet.moor(time); // the fleet comes in with the flagship (and its upkeep is paid)
        // errands done here are paid, and the ones that ran out of time are dropped
        for (const r of settleQuests(st, dockedAt.id, time)) events.push({ type: 'quest', owner: 'player', x: ship.x, y: 0, z: ship.z, won: r.done, text: r.text });
      }
    } else if (wasDocked) {
      fleet.launch(); // casting off: the consorts take their stations
    }
  };

  /** The run's `ship` record as the game has it now (hull and condition live in the closure while sailing). */
  const syncShip = (): void => {
    st.ship = { specId: spec.id, hp, rigging: ship.rigging, flooding: ship.flooding, fire: ship.fire };
  };
  /** The captain sails `next` now (bought, or the same ship repaired): take its numbers and condition from `st.ship`. */
  const equip = (next: ShipSpec): void => {
    if (next.id !== spec.id) {
      spec = next;
      maxHp = next.stats.hp;
      crew = crewFor(next);
      reload.port = 0;
      reload.starboard = 0;
      salvo.clear();
      elevation = ELEVATION.rest;
      director.dropAll(); // they were picked for the old ship
    }
    hp = Math.min(maxHp, Math.max(1, st.ship.hp));
    ship.rigging = st.ship.rigging;
    ship.flooding = st.ship.flooding;
    ship.fire = st.ship.fire;
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
    dockedAt = null;
    balls = [];
    events = [];
    director.reset();
    fleet.launch();
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
    events.push({ type: 'sunk', owner: 'player', x: ship.x, y: 0, z: ship.z, length: spec.length });
  };

  /** Move an enemy-shaped hull one step: the sailing model, the sea's motion, leaks and fire. */
  const advance = (c: Enemy, controls: Controls, dt: number): void => {
    stepPlayerShip(c.ship, c.spec, feel(c.ship), controls, dt, seaEffects(c.spec, c.ship.heading, wind.from, sea));
    stepBody(c.ship.body, c.ship, c.spec, time, wind.from, sea, dt, false, weather.tuning);
    c.hp = Math.max(0, c.hp - stepAffliction(c.ship, c.maxHp, false, dt));
  };
  /** The captain's fleet: consorts that follow the flagship, fight its enemies and are shot at like it. */
  const fleet = createFleetDirector({
    st,
    ship: () => ship,
    wind: () => wind,
    enemies: () => director.list(),
    advance,
    fire: (hull, s, side, alive) => fire('player', hull, s, side, alive),
    emit: (e) => events.push(e),
    repairRate: REPAIR_RATE,
  });
  /** The enemies: squads of them spawn, hunt the nearest of the captain's ships, fire and sink. */
  const director = createEnemyDirector({
    st,
    rng,
    ship: () => ship,
    spec: () => spec,
    wind: () => wind,
    consorts: () => fleet.consorts(),
    advance,
    fire: (hull, s, side, alive) => fire('enemy', hull, s, side, alive),
    emit: (e) => events.push(e),
    sunk: () => sunk,
    docked: () => !!dockedAt,
  });

  /** Fly the balls: three sub-steps a frame (a ball moves 1.5 m a step, narrow targets are not skipped), drag and wind included. */
  const stepBalls = (dt: number): void => {
    const air = windVelocity(wind);
    const world: ShotWorld = {
      player: { ship, spec, maxHp, targetable: !sunk && !dockedAt }, // a moored ship is safe in the harbour
      enemies: director.list(),
      consorts: fleet.consorts(),
      merchants: merchants.targets(others, time),
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
        director.sunkCheck(e);
      },
      onConsortHit: (c, lost) => fleet.hit(c, lost),
      onMerchantHit: (m, lost) => {
        if (!merchants.hit(m.id, m.spec, lost, time)) return;
        const o = others.find((x) => x.id === m.id);
        const at = o ?? m.ship;
        for (const e of plunderMerchant(st, m.spec, o?.nation ?? 'free', at, spec.stats.hold - holdUsed(st.hold), rng)) events.push(e);
      },
    };
    balls = flyBalls(balls, dt, air, world);
  };

  /** The ships the patrols steer clear of: the player's and the enemies afloat. */
  const giveWay = (): { x: number; z: number; length: number }[] => [
    { x: ship.x, z: ship.z, length: spec.length },
    ...director.list().filter((e) => e.sinking < 0).map((e) => ({ x: e.ship.x, z: e.ship.z, length: e.spec.length })),
    ...fleet.consorts().filter((c) => c.sinking < 0).map((c) => ({ x: c.ship.x, z: c.ship.z, length: c.spec.length })),
  ];

  reset(st.pose);
  // A loaded run keeps the state its ship was in and may begin moored.
  hp = Math.min(maxHp, Math.max(1, st.ship.hp));
  dockedAt = restoreShip(ship, st);
  if (dockedAt) fleet.moor(time);
  if (dockedAt) st.crew = Math.max(st.crew, Math.ceil(spec.stats.crew * COMPANY.volunteers)); // a port finds crew for a ship loaded moored, too
  explore.discover();

  return {
    get spec(): ShipSpec {
      return spec;
    },
    command(cmd): CommandResult {
      syncShip();
      const at = dockedAt?.id ?? null;
      if (cmd.type === 'buyShip' || cmd.type === 'repair') return runYard(st, spec, at, cmd, equip);
      if (cmd.type === 'buyConsort' || cmd.type === 'sellConsort' || cmd.type === 'repairConsort' || cmd.type === 'flagship') return runFleetYard(st, spec, at, cmd, equip);
      return runCommand(st, spec, at, time, cmd);
    },
    state(): GameState {
      fleet.sync();
      return snapshot(st, { spec, hp, ship, dockedAt: dockedAt?.id ?? null, islands: explore.islands(), ports: explore.ports(), time });
    },
    dev: createDevHooks({
      ship: () => ship,
      enemies: () => director.list(),
      setKills: (n) => director.setKills(n),
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
      fadeStanding(st, repClock, dt);
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
        const prize = desk.attempt(ship, director.list(), rng, events);
        if (prize) {
          if (fleet.capture(prize)) {
            director.takePrize(prize); // the prize joins the fleet under the captain's flag: the kill's experience and no sinking
          } else {
            prize.hp = 0;
            director.sunkCheck(prize, true); // no room in the fleet: the prize is scuttled, with a kill's experience (and the boarding bonus)
          }
        }
      }
      stepPlayerShip(ship, spec, feel(ship), controls, dt, seaEffects(spec, ship.heading, wind.from, sea));
      stepBody(ship.body, ship, spec, time, wind.from, sea, dt, !!dockedAt, weather.tuning);
      crew?.helm(ship.rudder);
      crew?.sails(ship.sailTarget);
      crew?.update(dt);
      shipCrews.update(dt);
      npcs.update(dt);

      reload.port = Math.max(0, reload.port - dt);
      reload.starboard = Math.max(0, reload.starboard - dt);
      elevation = Math.min(ELEVATION.max, Math.max(ELEVATION.min, elevation + (controls.elevate ?? 0) * ELEVATE_RATE * dt));
      const side: Side | null = controls.firePort ? 'port' : controls.fireStarboard ? 'starboard' : null;
      if (side && !dockedAt && reload[side] <= 0 && cannonsPerSide(spec) > 0) {
        fire('player', ship, spec, side, () => !sunk, elevation);
        reload[side] = desk.reloadSeconds();
        crew?.fire(side, reload[side]);
      }
      if (dockedAt) hp = Math.min(maxHp, hp + maxHp * REPAIR_RATE * dt);
      hp = Math.max(0, hp - stepAffliction(ship, maxHp, !!dockedAt, dt));
      checkPlayerSunk();

      director.step(dt);
      if (!dockedAt) fleet.step(dt);
      else for (const f of st.fleet) f.hp = Math.min(getShipSpec(f.specId)?.stats.hp ?? f.hp, f.hp + (getShipSpec(f.specId)?.stats.hp ?? 0) * REPAIR_RATE * dt); // moored: the fleet mends with the flagship
      // Ships that share the sea run into each other.
      others = merchants.mark(npcs.view(wind, giveWay()), time);
      const crash = stepCrashes({ ship, spec, maxHp, active: !dockedAt && !sunk }, director.list(), others.filter((o) => !o.sunk), (id, dx, dz, dyaw) => npcs.nudge(id, dx, dz, dyaw));
      events.push(...crash.events);
      crash.apply(
        (lost) => ((hp = Math.max(0, hp - lost)), desk.loseCrew(lost, maxHp, 'hull'), checkPlayerSunk()),
        (e, lost) => ((e.hp = Math.max(0, e.hp - lost)), director.sunkCheck(e)),
      );
      stepSalvo(dt);
      stepBalls(dt);
      explore.discover();
    },

    view(): GameView {
      if (dockedAt) syncShip(); // the yard's prices depend on the hull
      const n = nearest();
      const nearestPort = n && portView(n, ship, !dockedAt && canDock(n.port), insidePortZone(n.port, ship.x, ship.z), portClosed(st, n.port));
      const ships = shipViews(shipCrews, ship, feel, director.list(), fleet.consorts(), merchants.mark(npcs.view(wind, giveWay()), time));
      const afloat = director.list().filter((e) => e.sinking < 0);
      const drained = events;
      events = [];
      return {
        time,
        wind,
        hour: hourAt(time, clock),
        weather: weatherState.view(weather),
        seaState: sea,
        others: ships.others,
        crew: crew?.view() ?? [],
        captain: captainView(st),
        cargo: cargoView(st, spec),
        company: companyView(st, spec),
        port: dockedAt ? servicesView(st, spec, dockedAt.id, time) : null,
        boarding: boardingView(st, dockedAt || sunk ? null : desk.prize(ship, director.list()), desk.cooldown()),
        ship: playerView(ship, spec, { hp, maxHp, reloadSeconds: desk.reloadSeconds(), reload, elevation, air: windVelocity(wind), wind: feel(ship), gust: gustAt(ship.x, ship.z, time, wind), armed: !dockedAt && !sunk }, afloat),
        reputation: st.reputation,
        nearestPort,
        docked: dockedAt?.id ?? null,
        grounded: ship.grounded > 0,
        discoveredIslands: explore.islands(),
        discoveredPorts: explore.ports(),
        enemies: ships.enemies,
        consorts: ships.consorts,
        balls: ballViews(balls),
        events: drained,
        sunk,
        sinkTime,
        kills: director.kills(),
      };
    },
  };
}

function fail(message: string): never {
  throw new Error(message);
}

export type { Game };
