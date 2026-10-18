import { CONFIG, createRng } from '../core';
import type { BallView, Controls, GameEvent, GameView, PortView } from '../core';
import type { ShipSpec } from '../ships';
import { PORTS, getPort, terrainHeight, windAt, type Port } from '../world';
import { createExploration } from './exploration';
import { COMBAT, aimZone, ballHitZone, cannonsPerSide, fireBroadside, stepBall, targetInZone, type Ball, type Side } from './combat';
import { stepAffliction, strike } from './damage';
import { enemyView } from './enemyView';
import { MAX_ENEMIES, aiStep, createEnemy, desiredEnemies, findSpawn, lostTrack, pickEnemySpec, type Enemy } from './enemy';
import { SAILING, createPlayerShip, maxSpeed, stepPlayerShip } from './sailing';

export interface Game {
  readonly spec: ShipSpec;
  update(dt: number, controls: Controls): void;
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
  let wind = windAt(time);
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
  const fire = (owner: 'player' | 'enemy', hull: { x: number; z: number; heading: number; speed: number }, s: ShipSpec, side: Side): void => {
    const shot = fireBroadside(owner, hull, s, side, rng, () => ++ballCounter);
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

  const stepBalls = (dt: number): void => {
    const alive: Ball[] = [];
    for (const b of balls) {
      stepBall(b, dt);
      let consumed = false;
      if (b.owner === 'enemy') {
        // A moored ship is safe in the harbour.
        const zone = !sunk && !dockedAt ? ballHitZone(b, ship, spec) : null;
        if (zone) {
          const lost = strike(ship, zone, b.damage, maxHp, rng());
          hp = Math.max(0, hp - lost);
          events.push({ type: 'hit', owner: 'enemy', x: b.x, y: b.y, z: b.z, amount: lost, zone });
          consumed = true;
          checkPlayerSunk();
        }
      } else {
        for (const e of enemies) {
          const zone = e.sinking < 0 ? ballHitZone(b, e.ship, e.spec) : null;
          if (!zone) continue;
          const lost = strike(e.ship, zone, b.damage, e.maxHp, rng());
          e.hp = Math.max(0, e.hp - lost);
          events.push({ type: 'hit', owner: 'player', x: b.x, y: b.y, z: b.z, amount: lost, zone });
          consumed = true;
          checkEnemySunk(e);
          break;
        }
      }
      if (consumed) continue;
      if (b.y <= 0 || terrainHeight(b.x, b.z) > b.y) {
        events.push({ type: 'splash', owner: b.owner, x: b.x, y: 0, z: b.z });
        continue;
      }
      if (b.age < COMBAT.maxAge) alive.push(b);
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
      stepPlayerShip(e.ship, e.spec, wind, ai.controls, dt);
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
    dev: {
      damageEnemies(fraction): void {
        for (const e of enemies) if (e.sinking < 0) e.hp = Math.max(1, Math.round(e.maxHp * fraction));
      },
      teleportPlayer(x, z): void {
        ship.x = x;
        ship.z = z;
        explore.discover();
      },
      setKills(n): void {
        kills = n;
      },
      setRigging(fraction): void {
        ship.rigging = Math.min(Math.max(fraction, 0), 1);
      },
      setAffliction(flooding, fire): void {
        ship.flooding = Math.min(Math.max(flooding, 0), 1);
        ship.fire = Math.min(Math.max(fire, 0), 1);
      },
    },
    update(dt, controls): void {
      time += dt;
      wind = windAt(time);
      if (sunk) {
        sinkTime += dt;
        ship.speed *= 1 - 0.4 * dt;
        stepBalls(dt);
        // A restart asked for during the first moments of sinking is honoured once the screen shows.
        if (controls.restart) restartAsked = true;
        if (restartAsked && sinkTime > 2) reset();
        return;
      }
      if (controls.interact) toggleDock();
      stepPlayerShip(ship, spec, wind, controls, dt);

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
      stepBalls(dt);
      explore.discover();
    },

    view(): GameView {
      const n = nearest();
      const nearestPort: PortView | null = n && {
        id: n.port.id,
        name: n.port.name,
        distance: n.distance,
        direction: Math.atan2(-(n.port.anchor.z - ship.z), n.port.anchor.x - ship.x),
        dockable: !dockedAt && canDock(n.distance),
      };
      const enemyViews = enemies.map((e) => enemyView(e, ship));
      const ballViews: BallView[] = balls.map((b) => ({ id: b.id, owner: b.owner, x: b.x, y: b.y, z: b.z }));
      const zone = aimZone(spec, ship.speed);
      const afloat = enemies.filter((e) => e.sinking < 0);
      const drained = events;
      events = [];
      return {
        time,
        wind,
        ship: {
          x: ship.x,
          z: ship.z,
          heading: ship.heading,
          speed: ship.speed,
          knots: ship.speed / SAILING.speedScale,
          maxKnots: maxSpeed(spec) / SAILING.speedScale,
          rudder: ship.rudder,
          sailLevel: ship.sailLevel,
          sailTarget: ship.sailTarget,
          efficiency: ship.efficiency,
          roll: ship.roll,
          hp,
          maxHp,
          rigging: ship.rigging,
          flooding: ship.flooding,
          fire: ship.fire,
          guns: cannonsPerSide(spec),
          aim: zone,
          inRange: {
            port: afloat.some((e) => targetInZone(zone, ship, 'port', e.ship, e.spec.length)),
            starboard: afloat.some((e) => targetInZone(zone, ship, 'starboard', e.ship, e.spec.length)),
          },
          reload: {
            port: reload.port / COMBAT.playerReload,
            starboard: reload.starboard / COMBAT.playerReload,
          },
        },
        nearestPort,
        docked: dockedAt?.id ?? null,
        grounded: ship.grounded > 0,
        discoveredIslands: explore.islands(),
        discoveredPorts: explore.ports(),
        enemies: enemyViews,
        balls: ballViews,
        events: drained,
        sunk,
        sinkTime,
        kills,
      };
    },
  };
}
