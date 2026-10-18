import { CONFIG, createRng } from '../core';
import type { BallView, Controls, EnemyView, GameEvent, GameView, PortView } from '../core';
import type { ShipSpec } from '../ships';
import { PORTS, getPort, terrainHeight, windAt, type Port } from '../world';
import { createExploration } from './exploration';
import { COMBAT, aimZone, ballHits, cannonsPerSide, fireBroadside, stepBall, targetInZone, type Ball, type Side } from './combat';
import { aiStep, createEnemy, lostTrack, pickEnemySpec, type Enemy } from './enemy';
import { SAILING, createPlayerShip, maxSpeed, stepPlayerShip } from './sailing';

export interface Game {
  readonly spec: ShipSpec;
  update(dt: number, controls: Controls): void;
  /** Snapshot for render and UI. Drains `events`, so call it once per frame. */
  view(): GameView;
}

/** Docking needs the ship this close to the anchorage and this slow. */
export const DOCK = { range: 80, maxSpeed: 2.5 } as const;
const START_PORT = 'douwesen';
/** Start this far off the anchorage, facing open water. */
const START_OFFSET = 70;
/** Enemies appear this far from the player; a replacement comes after `RESPAWN` seconds. */
const SPAWN_DISTANCE = 650;
const RESPAWN = 25;
/** Fraction of hull strength a moored ship repairs per second. */
const REPAIR_RATE = 0.02;

/** Open-sea sandbox: one player ship, an archipelago with ports, and an enemy hunting you. */
export function createGame(spec: ShipSpec): Game {
  const start = getPort(START_PORT) ?? PORTS[0];
  if (!start) throw new Error('no ports defined');
  const rng = createRng(0x5eed);
  const enemySpec = pickEnemySpec(spec);
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
  /** Place a new enemy in open water about SPAWN_DISTANCE away, preferring the player's heading. */
  const spawnEnemy = (): void => {
    const preferred = ship.heading;
    for (let k = 0; k < 16; k++) {
      const angle = k === 0 ? preferred : rng() * Math.PI * 2;
      const x = ship.x + Math.cos(angle) * SPAWN_DISTANCE;
      const z = ship.z - Math.sin(angle) * SPAWN_DISTANCE;
      if (terrainHeight(x, z) < -(enemySpec.draft + 8)) {
        enemies.push(createEnemy(`e${++enemyCounter}`, enemySpec, x, z, angle + Math.PI));
        return;
      }
    }
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

  const stepBalls = (dt: number): void => {
    const alive: Ball[] = [];
    for (const b of balls) {
      stepBall(b, dt);
      let consumed = false;
      if (b.owner === 'enemy') {
        // A moored ship is safe in the harbour.
        if (!sunk && !dockedAt && ballHits(b, ship, spec)) {
          hp = Math.max(0, hp - b.damage);
          events.push({ type: 'hit', owner: 'enemy', x: b.x, y: b.y, z: b.z, amount: b.damage });
          consumed = true;
          if (hp <= 0) {
            sunk = true;
            sinkTime = 0;
            events.push({ type: 'sunk', owner: 'player', x: ship.x, y: 0, z: ship.z });
          }
        }
      } else {
        for (const e of enemies) {
          if (e.sinking >= 0 || !ballHits(b, e.ship, e.spec)) continue;
          e.hp = Math.max(0, e.hp - b.damage);
          events.push({ type: 'hit', owner: 'player', x: b.x, y: b.y, z: b.z, amount: b.damage });
          consumed = true;
          if (e.hp <= 0) {
            e.sinking = 0;
            kills++;
            respawnIn = RESPAWN;
            events.push({ type: 'sunk', owner: 'enemy', x: e.ship.x, y: 0, z: e.ship.z });
          }
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
      const ai = aiStep(e, ship, wind);
      stepPlayerShip(e.ship, e.spec, wind, ai.controls, dt);
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
    if (!sunk && respawnIn <= 0 && !enemies.some((e) => e.sinking < 0)) spawnEnemy();
  };

  reset();
  explore.discover();

  return {
    spec,
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
      const enemyViews: EnemyView[] = enemies.map((e) => ({
        id: e.id,
        specId: e.spec.id,
        name: e.spec.name,
        x: e.ship.x,
        z: e.ship.z,
        heading: e.ship.heading,
        speed: e.ship.speed,
        roll: e.ship.roll,
        sailLevel: e.ship.sailLevel,
        hp: e.hp,
        maxHp: e.maxHp,
        sinking: e.sinking,
        fleeing: e.fleeing,
        distance: Math.hypot(e.ship.x - ship.x, e.ship.z - ship.z),
        direction: Math.atan2(-(e.ship.z - ship.z), e.ship.x - ship.x),
      }));
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
