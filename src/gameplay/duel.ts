import { createRng } from '../core';
import type { ShipSpec } from '../ships';
import { windAt } from '../world';
import { COMBAT, ballHits, fireBroadside, stepBall, type Ball } from './combat';
import { ENEMY_TUNING, aiStep, createEnemy, lostTrack, type Enemy } from './enemy';
import { stepPlayerShip } from './sailing';

/**
 * Headless duels: two ships fight on the real sailing, ballistics and damage code, both
 * steered by the enemy AI, with no rendering. Used to measure balance (`npm run balance`)
 * and to guard it in tests. Everything is seeded, so a duel is reproducible.
 */
export interface DuelSide {
  spec: ShipSpec;
  /** Hull strength as a fraction of the listed value. */
  hullFactor: number;
  /** Seconds to reload a broadside. */
  reload: number;
  /** Sideways spread, as a multiple of the player's. */
  spread: number;
  /** Break off from the start and run: measures whether a chase can be shaken (the other side hunts). */
  flees?: boolean;
}

/** A side that fights as the player does: full hull, the player's reload and accuracy. */
export const playerSide = (spec: ShipSpec): DuelSide => ({ spec, hullFactor: 1, reload: COMBAT.playerReload, spread: 1 });
/** A side that fights as the game's enemies do, handicap included. */
export const enemySide = (spec: ShipSpec): DuelSide => ({
  spec,
  hullFactor: ENEMY_TUNING.hullFactor,
  reload: COMBAT.enemyReload,
  spread: COMBAT.enemySpread,
});

export type DuelOutcome =
  | 'a-won' // b sank
  | 'b-won' // a sank
  | 'b-broke' // b was beaten down to the flee threshold and broke off: a won the fight
  | 'a-broke'
  | 'a-escaped' // b lost track of a: a got away (a runner faster than its hunter, or two ships drifting apart)
  | 'b-escaped'
  | 'timeout';

export interface DuelResult {
  outcome: DuelOutcome;
  seconds: number;
  /** Remaining hull as a fraction of each side's maximum. */
  hullA: number;
  hullB: number;
  hitsA: number;
  hitsB: number;
  /** Balls fired by each side. */
  shotsA: number;
  shotsB: number;
}

export interface DuelOptions {
  seed?: number;
  /** Simulated seconds before the duel is called a timeout. */
  maxSeconds?: number;
  /** Fixed step; the ball physics runs in sub-steps so fast balls cannot skip a hull. */
  dt?: number;
  /** Starting distance, metres. */
  distance?: number;
  /** Swap the starting sides (a starts on the east and faces west): the wind and the AI's tie-breaks favour one side, so fair measurements run both. */
  swapped?: boolean;
  /** Randomise the start a little (sideways offset, heading, wind phase) from the seed, so a pairing is a distribution and not one fixed geometry. Default on. */
  jitter?: boolean;
}

const OPEN_SEA = { x: 40000, z: 40000 };
const BALL_SUBSTEPS = 4;

interface Fighter {
  e: Enemy;
  side: DuelSide;
  hits: number;
  shots: number;
}

function makeFighter(id: string, side: DuelSide, x: number, z: number, heading: number): Fighter {
  const e = createEnemy(id, side.spec, x, z, heading);
  e.maxHp = Math.round(side.spec.stats.hp * side.hullFactor);
  e.hp = e.maxHp;
  e.reload.port = side.reload / 2;
  e.reload.starboard = side.reload / 2;
  e.fleeing = side.flees === true;
  return { e, side, hits: 0, shots: 0 };
}

/** Fight `a` against `b` from `distance` apart, facing each other, until one sinks, gives up, or time runs out. */
export function runDuel(a: DuelSide, b: DuelSide, options: DuelOptions = {}): DuelResult {
  const { seed = 1, maxSeconds = 420, dt = 1 / 20, distance = 650, swapped = false, jitter = true } = options;
  const rng = createRng(seed);
  let ballId = 0;
  const nextId = (): number => ++ballId;

  // They start roughly head-on: normally a is in the west facing east, swapped it is the other way round.
  // The jitter draws come first and always (even when off), so toggling it does not shift the fight's own random numbers.
  const j = (range: number): number => (jitter ? (rng() * 2 - 1) * range : 0 * rng());
  const side = j(150);
  const turnA = j(0.4);
  const turnB = j(0.4);
  const windPhase = jitter ? rng() * 1000 : 0 * rng();
  const fa = makeFighter('a', a, OPEN_SEA.x + (swapped ? distance : 0), OPEN_SEA.z + side, (swapped ? Math.PI : 0) + turnA);
  const fb = makeFighter('b', b, OPEN_SEA.x + (swapped ? 0 : distance), OPEN_SEA.z - side, (swapped ? 0 : Math.PI) + turnB);
  let balls: Ball[] = [];
  let seconds = 0;
  let outcome: DuelOutcome = 'timeout';

  const act = (me: Fighter, foe: Fighter, wind: ReturnType<typeof windAt>): void => {
    const ai = aiStep(me.e, foe.e.ship, wind);
    stepPlayerShip(me.e.ship, me.e.spec, wind, ai.controls, dt);
    me.e.reload.port = Math.max(0, me.e.reload.port - dt);
    me.e.reload.starboard = Math.max(0, me.e.reload.starboard - dt);
    if (ai.fire) {
      const shot = fireBroadside(me === fa ? 'player' : 'enemy', me.e.ship, me.e.spec, ai.fire, rng, nextId, me.side.spread);
      balls.push(...shot.balls);
      me.shots += shot.balls.length;
      me.e.reload[ai.fire] = me.side.reload;
    }
  };

  while (seconds < maxSeconds && outcome === 'timeout') {
    const wind = windAt(seconds + windPhase);
    act(fa, fb, wind);
    act(fb, fa, wind);

    const sub = dt / BALL_SUBSTEPS;
    for (let k = 0; k < BALL_SUBSTEPS; k++) {
      const alive: Ball[] = [];
      for (const ball of balls) {
        stepBall(ball, sub);
        const target = ball.owner === 'player' ? fb : fa;
        const shooter = ball.owner === 'player' ? fa : fb;
        if (ballHits(ball, target.e.ship, target.e.spec)) {
          target.e.hp = Math.max(0, target.e.hp - ball.damage);
          shooter.hits++;
          continue;
        }
        if (ball.y > 0 && ball.age < COMBAT.maxAge) alive.push(ball);
      }
      balls = alive;
    }
    seconds += dt;

    if (fb.e.hp <= 0) outcome = 'a-won';
    else if (fa.e.hp <= 0) outcome = 'b-won';
    // A side that was told to flee from the start has not "broken" in battle: the chase is the point.
    else if (fb.e.fleeing && !b.flees) outcome = 'b-broke';
    else if (fa.e.fleeing && !a.flees) outcome = 'a-broke';
    else {
      const gap = Math.hypot(fa.e.ship.x - fb.e.ship.x, fa.e.ship.z - fb.e.ship.z);
      // Out of sight for too long: the one left behind gives up, so the other has escaped.
      const aLost = lostTrack(fa.e, gap, dt);
      const bLost = lostTrack(fb.e, gap, dt);
      if (bLost) outcome = 'a-escaped';
      else if (aLost) outcome = 'b-escaped';
    }
  }

  return {
    outcome,
    seconds,
    hullA: fa.e.hp / fa.e.maxHp,
    hullB: fb.e.hp / fb.e.maxHp,
    hitsA: fa.hits,
    hitsB: fb.hits,
    shotsA: fa.shots,
    shotsB: fb.shots,
  };
}
