import { clamp, type Attitude } from '../core';
import type { ShipSpec } from '../ships';
import { NEUTRAL_TUNING, seaAmp, waveHeight, type SeaTuning } from '../world';

/**
 * How a hull rides the sea: it heaves, pitches and rolls toward the surface sampled under its bow, stern and
 * sides, but as a spring with damping, so a big ship is slow and filters out short waves while a small one
 * follows every crest. Deterministic and fixed-step, so the game, the render and the tests agree.
 */
/** State of the three springs: position and velocity of each. */
export interface Body extends Attitude {
  heaveV: number;
  pitchV: number;
  rollV: number;
}

export const createBody = (): Body => ({ heave: 0, heaveV: 0, pitch: 0, pitchV: 0, waveRoll: 0, rollV: 0 });

/** Share of the surface slope the hull follows: ships ride the waves but do not lie flat on them. */
const PITCH_GAIN = 0.8;
const ROLL_GAIN = 0.6;
/** A hull moored in harbour feels only a swell of this size. */
const HARBOUR_SHELTER = 0.3;

/** Natural period (s) of each motion: it grows with the length of the ship. */
export const periods = (length: number): { heave: number; pitch: number; roll: number } => ({
  heave: 2 + 0.15 * length,
  pitch: 2.5 + 0.12 * length,
  roll: 3 + 0.15 * length,
});

export interface BuoyancyInput {
  x: number;
  z: number;
  heading: number;
}

/** Spring toward `target` for a natural period `period` and damping ratio `zeta`; semi-implicit Euler, stable at 60 Hz. */
function spring(pos: number, vel: number, target: number, period: number, zeta: number, dt: number): [number, number] {
  const w = (2 * Math.PI) / period;
  const v = vel + (w * w * (target - pos) - 2 * zeta * w * vel) * dt;
  return [pos + v * dt, v];
}

/** Move `body` one fixed step toward the sea surface at `time`. `docked` shelters the hull in harbour. */
export function stepBody(
  body: Body,
  ship: BuoyancyInput,
  spec: ShipSpec,
  time: number,
  windFrom: number,
  seaState: number,
  dt: number,
  docked = false,
  tuning: SeaTuning = NEUTRAL_TUNING,
): void {
  const amp = seaAmp(seaState) * (docked ? HARBOUR_SHELTER : 1);
  const c = Math.cos(ship.heading);
  const s = Math.sin(ship.heading);
  const hl = spec.length * 0.4;
  const hb = spec.beam * 0.5;
  const at = (dx: number, dz: number): number => waveHeight(ship.x + dx, ship.z + dz, time, windFrom, amp, 0, tuning);
  // forward is (c, -s), starboard is (s, c)
  const bow = at(c * hl, -s * hl);
  const stern = at(-c * hl, s * hl);
  const stbd = at(s * hb, c * hb);
  const port = at(-s * hb, -c * hb);
  const per = periods(spec.length);
  [body.heave, body.heaveV] = spring(body.heave, body.heaveV, (bow + stern + stbd + port) / 4, per.heave, 0.7, dt);
  [body.pitch, body.pitchV] = spring(body.pitch, body.pitchV, Math.atan2(bow - stern, 2 * hl) * PITCH_GAIN, per.pitch, 0.6, dt);
  [body.waveRoll, body.rollV] = spring(body.waveRoll, body.rollV, Math.atan2(stbd - port, 2 * hb) * ROLL_GAIN, per.roll, 0.35, dt);
  body.waveRoll = clamp(body.waveRoll, -0.6, 0.6);
}

/**
 * Sea effects on handling, zero in fair weather and growing to a storm: `sea` is the sea state, `headSea` how
 * directly the bow meets the waves (1 head on, 0 beam on or following) and `size` how much a ship of this length
 * is thrown about (small ships suffer more).
 */
export interface SeaEffects {
  /** Multiplier on the speed the sails can give. */
  speed: number;
  /** Multiplier on how fast the ship turns. */
  turn: number;
  /** Flooding gained per second from green water coming over the bow. */
  shipping: number;
  /** Share of the full leeway (the sideways slip under wind) a ship makes: 1 in the game, 0 in the duel simulator, which has no sea. */
  lee: number;
}

/** Scatter multiplier for guns fired from a hull that is rolling and pitching in a rough sea (1 in fair weather). */
export function gunScatter(body: Attitude, seaState: number): number {
  return 1 + smooth(0.3, 1, seaState) * (3 * Math.abs(body.waveRoll) + 2 * Math.abs(body.pitch));
}

export const NO_SEA_EFFECTS: SeaEffects = { speed: 1, turn: 1, shipping: 0, lee: 0 };
/** The effects of a calm sea in the game: nothing, but the ship slips to leeward. */
const CALM: SeaEffects = { ...NO_SEA_EFFECTS, lee: 1 };

const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The effects of `seaState` on a ship heading `heading` when the waves come from `windFrom`. */
export function seaEffects(spec: ShipSpec, heading: number, windFrom: number, seaState: number): SeaEffects {
  // Below a moderate sea nothing changes: fair-weather sailing and the balance tables stay as they are.
  const rough = smooth(0.3, 1, seaState);
  if (rough <= 0) return CALM;
  const headSea = Math.max(0, Math.cos(heading - windFrom)); // headings and the wind's origin share one angle convention;
  const size = clamp(30 / spec.length, 0.5, 1.6);
  // Green water over the bow of a low ship: wave height against freeboard, only when meeting the waves.
  const awash = clamp((seaAmp(seaState) * 0.9 - spec.freeboard * 1.1) / 1.5, 0, 1);
  return {
    speed: 1 - 0.22 * rough * headSea * size,
    turn: 1 - 0.2 * rough * size,
    shipping: 0.02 * awash * (0.4 + 0.6 * headSea),
    lee: 1,
  };
}
