import { clamp, smoothstep, wrapAngle } from '../core';

/**
 * The CPU half of the sail and flag cloth: a handful of smoothed numbers per ship (furl per tier, belly, flutter,
 * yard swing, flag direction) that the vertex shaders turn into cloth. Pure and allocation-free after creation;
 * every integrator is exact (or monotone), so any `dt`, even a long hitch, leaves the state finite and bounded.
 */

/** Most square-sail tiers on one mast (docs/SHIPS.md: the specs have 2 or 3). */
export const MAX_TIERS = 3;

/** Apparent wind at the ship: `angle` from the bow (+ = from port), `speed` m/s, `gust` multiplier 0.75…1.25. */
export interface WindInput {
  angle: number;
  speed: number;
  gust: number;
}

export interface Spring {
  x: number;
  v: number;
}

/** Wall clock in seconds for ships that are not told the frame time; tests replace `now`. */
export const clothClock = { now: (): number => performance.now() / 1000 };

/** Exact step of a critically damped spring towards `target` (`omega` ≈ 3 / settle time). Stable for every dt ≥ 0. */
export function springStep(s: Spring, target: number, omega: number, dt: number): void {
  const h = clamp(dt, 0, 10);
  const e = Math.exp(-omega * h);
  const d = s.x - target;
  const t = (s.v + omega * d) * h;
  s.x = target + (d + t) * e;
  s.v = (s.v - omega * t) * e;
}

/** Spring on an angle that may go round: the target is taken the short way from `s.x`. */
export function springAngleStep(s: Spring, target: number, omega: number, dt: number): void {
  springStep(s, s.x + wrapAngle(target - s.x), omega, dt);
}

/** Furl speed of one tier (fraction of its height per second): full furl or unfurl takes about 1.8 s. */
export const FURL_RATE = 0.55;
/** A tier starts furling once the one below is this far gathered; it starts to open once the one above is below `OPEN_AFTER`. */
const FURL_AFTER = 0.45;
const OPEN_AFTER = 0.55;

/**
 * Furl target (0 = open … 1 = gathered) of each of `tiers` slots for a sail `level` 0…1: the lowest tier is gathered
 * first, the top one last. Slot `j` is the j-th tier from the bottom (masts with fewer tiers use the upper slots).
 */
export function furlTargets(level: number, tiers: number, out: number[]): void {
  const c = (1 - clamp(level, 0, 1)) * tiers;
  for (let j = 0; j < MAX_TIERS; j++) out[j] = j < tiers ? clamp(c - j, 0, 1) : 0;
}

export interface ClothState {
  readonly tiers: number;
  /** Rate-limited furl of each slot (what the sequencing acts on) and the spring-smoothed value the shader gets. */
  readonly raw: number[];
  readonly furl: Spring[];
  furlAftRaw: number;
  readonly furlAft: Spring;
  readonly targets: number[];
  /** Belly, signed: square sails 0…1 (never backed through the mast), fore-and-aft sails −1…1 (follows the wind side). */
  readonly belly: Spring;
  readonly bellyAft: Spring;
  readonly flutter: Spring;
  readonly flutterAft: Spring;
  /** Yard brace and sheet angle about the mast, signed like the wind side. */
  readonly brace: Spring;
  readonly sheet: Spring;
  /** Apparent wind as the flags see it (the angle is unwrapped). */
  readonly flagAngle: Spring;
  readonly flagSpeed: Spring;
  readonly flagGust: Spring;
  /** False until the first step, which snaps to the target instead of animating from nothing. */
  ready: boolean;
}

const spring = (x = 0): Spring => ({ x, v: 0 });

export function createClothState(tiers: number): ClothState {
  return {
    tiers: clamp(Math.round(tiers), 1, MAX_TIERS),
    raw: [0, 0, 0],
    furl: [spring(), spring(), spring()],
    furlAftRaw: 0,
    furlAft: spring(),
    targets: [0, 0, 0],
    belly: spring(),
    bellyAft: spring(),
    flutter: spring(),
    flutterAft: spring(),
    brace: spring(),
    sheet: spring(),
    flagAngle: spring(),
    flagSpeed: spring(8),
    flagGust: spring(1),
    ready: false,
  };
}

export interface ClothInput {
  /** Angle from the bow to the wind's origin the sails are trimmed to (+ = from port). */
  windRel: number;
  level: number;
  wind: WindInput;
  /** Battle damage to the sails, 0 (whole) … 1 (shredded). */
  tear: number;
}

/** How full a square sail is at apparent wind angle `a` (unsigned, rad): luffing in irons, full from the beam aft. */
export const squareFill = (a: number): number => smoothstep(0.45, 1.2, a);
/** The same for a fore-and-aft sail, which points closer to the wind. */
export const aftFill = (a: number): number => smoothstep(0.2, 0.8, a);

/** Strength of the wind on the cloth, 0.3…1.1, from the apparent speed and the gust. */
export const windPush = (speed: number, gust: number): number => clamp(speed / 9, 0.3, 1.1) * (0.85 + 0.15 * clamp(gust, 0.75, 1.25));

/** Fraction of full flutter the wind alone causes (luffing, gusts, a gale). */
export function flutterTarget(luff: number, speed: number, gust: number, tear: number): number {
  const gustPart = clamp((gust - 1) / 0.25, 0, 1) * 0.3;
  const gale = clamp((speed - 14) / 14, 0, 1) * 0.5;
  return clamp(luff * 0.95 + gustPart + gale + 0.1 * clamp(speed / 9, 0, 1.2) + 0.5 * tear, 0, 1.2);
}

function stepFurl(s: ClothState, dt: number): void {
  const n = s.tiers;
  const step = FURL_RATE * dt;
  for (let k = 0; k < n; k++) {
    const t = s.targets[k] as number;
    const r = s.raw[k] as number;
    if (t > r && (k === 0 || (s.raw[k - 1] as number) >= FURL_AFTER)) s.raw[k] = Math.min(t, r + step);
  }
  for (let k = n - 1; k >= 0; k--) {
    const t = s.targets[k] as number;
    const r = s.raw[k] as number;
    if (t < r && (k === n - 1 || (s.raw[k + 1] as number) <= OPEN_AFTER)) s.raw[k] = Math.max(t, r - step);
  }
  for (let k = 1; k < n; k++) s.raw[k] = Math.min(s.raw[k] as number, s.raw[k - 1] as number); // a lower tier is never the more open one
}

/** Advance the whole state by `dt` seconds towards the trim in `input`; the first call snaps to it. */
export function stepCloth(s: ClothState, input: ClothInput, dt: number): void {
  const level = clamp(input.level, 0, 1);
  const a = Math.abs(input.windRel);
  const side = input.windRel >= 0 ? 1 : -1;
  const wa = Math.abs(input.wind.angle);
  const push = windPush(input.wind.speed, input.wind.gust);
  furlTargets(level, s.tiers, s.targets);
  const aftTarget = 1 - level;

  // Closer to the wind: yards braced hard round, fore-and-aft sails sheeted in.
  const downwind = smoothstep(0.7, 3.0, a);
  const braceTarget = side * 0.65 * (1 - downwind);
  const sheetTarget = side * (0.08 + 1.02 * downwind);
  const bellyTarget = squareFill(wa) * push;
  const bellyAftTarget = (input.wind.angle >= 0 ? 1 : -1) * aftFill(wa) * push;
  const flutterSq = flutterTarget(1 - smoothstep(0.35, 0.9, wa), input.wind.speed, input.wind.gust, input.tear);
  const flutterAft = flutterTarget(1 - smoothstep(0.15, 0.5, wa), input.wind.speed, input.wind.gust, input.tear);

  if (!s.ready) {
    s.ready = true;
    for (let k = 0; k < MAX_TIERS; k++) {
      s.raw[k] = s.targets[k] as number;
      (s.furl[k] as Spring).x = s.raw[k] as number;
    }
    s.furlAftRaw = aftTarget;
    s.furlAft.x = aftTarget;
    s.belly.x = bellyTarget;
    s.bellyAft.x = bellyAftTarget;
    s.flutter.x = flutterSq;
    s.flutterAft.x = flutterAft;
    s.brace.x = braceTarget;
    s.sheet.x = sheetTarget;
    s.flagAngle.x = input.wind.angle;
    s.flagSpeed.x = input.wind.speed;
    s.flagGust.x = input.wind.gust;
    return;
  }

  stepFurl(s, dt);
  for (let k = 0; k < s.tiers; k++) springStep(s.furl[k] as Spring, s.raw[k] as number, 7, dt);
  s.furlAftRaw += clamp(aftTarget - s.furlAftRaw, -FURL_RATE * dt, FURL_RATE * dt);
  springStep(s.furlAft, s.furlAftRaw, 7, dt);
  springStep(s.belly, bellyTarget, 1.6, dt);
  springStep(s.bellyAft, bellyAftTarget, 1.6, dt);
  springStep(s.flutter, flutterSq, 3, dt);
  springStep(s.flutterAft, flutterAft, 3, dt);
  springStep(s.brace, braceTarget, 2.2, dt);
  springStep(s.sheet, sheetTarget, 2, dt);
  springAngleStep(s.flagAngle, input.wind.angle, 3, dt);
  springStep(s.flagSpeed, input.wind.speed, 1.5, dt);
  springStep(s.flagGust, input.wind.gust, 2, dt);
}

/** Mean furl over the slots in use (0 open … 1 gathered), for the models that scale instead of gather. */
export function meanFurl(s: ClothState): number {
  let sum = 0;
  for (let k = 0; k < s.tiers; k++) sum += clamp((s.furl[k] as Spring).x, 0, 1);
  return sum / s.tiers;
}
