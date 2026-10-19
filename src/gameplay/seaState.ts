import { getShipSpec } from '../ships';
import { REPUTATION_NATIONS, WORLD_BOUNDS } from '../world';
import type { Ball } from './combat';
import { COMBAT } from './combat';
import { ENEMY_TUNING, MAX_ENEMIES, createEnemy, type Enemy } from './enemy';

/** What is at sea around the captain when the game is saved: the enemies afloat and the balls in the air. */
export interface SavedEnemy {
  specId: string;
  nation: string;
  x: number;
  z: number;
  heading: number;
  speed: number;
  hp: number;
  rigging: number;
  flooding: number;
  fire: number;
  reloadPort: number;
  reloadStarboard: number;
  sailTarget: number;
  fleeing: boolean;
  surrendered: boolean;
}

export interface SavedBall {
  owner: 'player' | 'enemy';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  age: number;
}

export interface SeaState {
  enemies: SavedEnemy[];
  balls: SavedBall[];
  /** How many enemies have been met this run (the next one's nation and type follow from it) and the run's sunk count. */
  counter: number;
  threat: number;
}

/** Most balls a save keeps (a broadside is about 20). */
export const MAX_SAVED_BALLS = 64;

export const saveEnemy = (e: Enemy): SavedEnemy => ({
  specId: e.spec.id, nation: e.nation, x: e.ship.x, z: e.ship.z, heading: e.ship.heading, speed: e.ship.speed, hp: e.hp,
  rigging: e.ship.rigging, flooding: e.ship.flooding, fire: e.ship.fire, reloadPort: e.reload.port, reloadStarboard: e.reload.starboard,
  sailTarget: e.ship.sailTarget, fleeing: e.fleeing, surrendered: e.surrendered,
});

export const saveBall = (b: Ball): SavedBall => ({ owner: b.owner, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, damage: b.damage, age: b.age });

/** The enemy that was saved, afloat again under `id`. */
export function restoreEnemy(s: SavedEnemy, id: string): Enemy | null {
  const spec = getShipSpec(s.specId);
  if (!spec) return null;
  const e = createEnemy(id, spec, s.x, s.z, s.heading, s.nation);
  e.hp = s.hp;
  e.ship.speed = s.speed;
  e.ship.rigging = s.rigging;
  e.ship.flooding = s.flooding;
  e.ship.fire = s.fire;
  e.ship.sailTarget = s.sailTarget;
  e.ship.sailLevel = s.sailTarget;
  e.reload = { port: s.reloadPort, starboard: s.reloadStarboard };
  e.fleeing = s.fleeing;
  e.surrendered = s.surrendered;
  return e;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
/** How far beyond the islands a saved ship or ball may lie (m). */
const FAR = 3000;

/**
 * Turn whatever a file holds as `sea` into a valid state, or undefined: unknown ships and nations are dropped, every
 * number is clamped, no more than the game's enemies and a volley or two of balls are kept.
 */
export function sanitizeSea(raw: unknown): SeaState | undefined {
  if (!isRecord(raw)) return undefined;
  const lox = WORLD_BOUNDS.minX - FAR;
  const hix = WORLD_BOUNDS.maxX + FAR;
  const loz = WORLD_BOUNDS.minZ - FAR;
  const hiz = WORLD_BOUNDS.maxZ + FAR;
  const enemies: SavedEnemy[] = [];
  for (const e of Array.isArray(raw.enemies) ? raw.enemies : []) {
    if (enemies.length >= MAX_ENEMIES) break;
    if (!isRecord(e) || typeof e.specId !== 'string' || typeof e.nation !== 'string') continue;
    const spec = getShipSpec(e.specId);
    if (!spec || !REPUTATION_NATIONS.includes(e.nation)) continue;
    const maxHp = Math.round(spec.stats.hp * ENEMY_TUNING.hullFactor);
    enemies.push({
      specId: spec.id, nation: e.nation, x: num(e.x, 0, lox, hix), z: num(e.z, 0, loz, hiz), heading: num(e.heading, 0, -1e4, 1e4), speed: num(e.speed, 0, -50, 50),
      hp: Math.round(num(e.hp, maxHp, 1, maxHp)), rigging: num(e.rigging, 1, 0, 1), flooding: num(e.flooding, 0, 0, 1), fire: num(e.fire, 0, 0, 1),
      reloadPort: num(e.reloadPort, 0, 0, COMBAT.enemyReload), reloadStarboard: num(e.reloadStarboard, 0, 0, COMBAT.enemyReload),
      sailTarget: num(e.sailTarget, 1, 0, 1), fleeing: e.fleeing === true, surrendered: e.surrendered === true,
    });
  }
  const balls: SavedBall[] = [];
  for (const b of Array.isArray(raw.balls) ? raw.balls : []) {
    if (balls.length >= MAX_SAVED_BALLS) break;
    if (!isRecord(b) || (b.owner !== 'player' && b.owner !== 'enemy')) continue;
    balls.push({
      owner: b.owner, x: num(b.x, 0, lox, hix), y: num(b.y, 0, -5, 200), z: num(b.z, 0, loz, hiz),
      vx: num(b.vx, 0, -400, 400), vy: num(b.vy, 0, -400, 400), vz: num(b.vz, 0, -400, 400), damage: num(b.damage, 0, 0, 1000), age: num(b.age, 0, 0, COMBAT.maxAge),
    });
  }
  return { enemies, balls, counter: Math.floor(num(raw.counter, 0, 0, 1e6)), threat: Math.floor(num(raw.threat, 0, 0, 1e6)) };
}
