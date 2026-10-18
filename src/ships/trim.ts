import type * as THREE from 'three';
import { clamp } from '../core';
import {
  clothClock,
  createClothState,
  meanFurl,
  stepCloth,
  type ClothInput,
  type ClothState,
  type WindInput,
} from './clothState';
import { tickClothTime, type ClothUniforms } from './clothShader';

/**
 * Sail nodes the game rotates when the wind or the sail level changes. Procedural ships name
 * them `trim-square` / `trim-aft`; GLB ships prefix a LOD (`LOD1_trim-aft`), hence `endsWith`.
 */
export interface SailNodes {
  square: THREE.Object3D[];
  aft: THREE.Object3D[];
}

export function collectSailNodes(root: THREE.Object3D): SailNodes {
  const nodes: SailNodes = { square: [], aft: [] };
  root.traverse((o) => {
    if (o.name.endsWith('trim-square')) nodes.square.push(o);
    else if (o.name.endsWith('trim-aft')) nodes.aft.push(o);
  });
  return nodes;
}

/** Wind trim and battle damage on the sails. */
export interface SailTrim {
  /**
   * `windRel` is the signed angle from the bow to the wind's origin (+ = wind from port);
   * `level` is sail deployment 0 (furled) … 1 (full). Call it once per frame: the sails ease towards the trim.
   */
  trim(windRel: number, level: number): void;
  /** Apparent wind (angle from the bow, m/s, gust 0.75…1.25) for belly, flutter and flags; defaults to `windRel` at 8 m/s. */
  setWind(wind: WindInput): void;
  /** Damage factor (0.55…1) on the sail height, from `ConditionRig.sailHeight`. */
  setDamageHeight(height: number): void;
  /** The smoothed numbers the cloth is drawn from (read-only; tests and debugging). */
  readonly state: ClothState;
}

export interface SailTrimOptions {
  /** Most square-sail tiers on one mast (sets how the furl is shared out). */
  tiers?: number;
  /** Jibs on the ship (each gets its own furl and belly). */
  jibs?: number;
  /** The cloth shader's uniforms: furl, belly, flutter, tear and the flags' wind are written here. */
  cloth?: ClothUniforms;
  /** Pivots whose sails are drawn by the cloth shader: they only swing, the others are scaled. */
  shaded?: ReadonlySet<THREE.Object3D>;
}

/** Lowest height factor of a sail that is scaled instead of gathered; below this it is hidden. */
const MIN_SCALE = 0.04;
/** Sail damage tears the cloth fully at this height factor (`MIN_SAIL_HEIGHT` of `condition.ts`). */
const MIN_DAMAGE_HEIGHT = 0.55;

export function createSailTrim(nodes: SailNodes, options: SailTrimOptions = {}): SailTrim {
  const state = createClothState(options.tiers ?? 2, options.jibs ?? 0);
  const cloth = options.cloth;
  const shaded = options.shaded;
  const wind: WindInput = { angle: 0, speed: 8, gust: 1 };
  const input: ClothInput = { windRel: 0, level: 1, wind, tear: 0 };
  let windGiven = false;
  let damage = 1;
  let last = -1;

  const write = (): void => {
    const furl0 = meanFurl(state);
    const heightSq = (MIN_SCALE + (1 - MIN_SCALE) * (1 - furl0)) * damage;
    const heightAft = (MIN_SCALE + (1 - MIN_SCALE) * (1 - state.furlAft.x)) * damage;
    // A sail scaled instead of gathered mirrors with the wind side; the sign passes through ±0.06 so it never collapses.
    const b = state.bellyAft.x;
    const side = b >= 0 ? Math.max(b, 0.06) : Math.min(b, -0.06);
    for (const o of nodes.square) {
      o.rotation.y = state.brace.x;
      if (shaded?.has(o)) continue;
      o.visible = heightSq / damage > 0.05;
      o.scale.set(1, heightSq, 1);
    }
    for (const o of nodes.aft) {
      o.rotation.y = state.sheet.x;
      if (shaded?.has(o)) continue;
      o.visible = heightAft / damage > 0.05;
      o.scale.set(1, heightAft, side);
    }
    if (!cloth) return;
    cloth.furl.value.set(state.furl[0]?.x ?? 0, state.furl[1]?.x ?? 0, state.furl[2]?.x ?? 0, state.furlAft.x);
    cloth.jibFurl.value.set(state.jibFurl[0]?.x ?? 0, state.jibFurl[1]?.x ?? 0, state.jibFurl[2]?.x ?? 0, 0);
    cloth.jibBelly.value.set(clamp(state.jibBelly[0]?.x ?? 0, -1.15, 1.15), clamp(state.jibBelly[1]?.x ?? 0, -1.15, 1.15), clamp(state.jibBelly[2]?.x ?? 0, -1.15, 1.15), 0);
    cloth.belly.value.set(clamp(state.belly.x, 0, 1.15), clamp(state.bellyAft.x, -1.15, 1.15));
    cloth.flutter.value.set(clamp(state.flutter.x, 0, 1.2), clamp(state.flutterAft.x, 0, 1.2));
    cloth.tear.value = input.tear;
    cloth.wind.value.set(state.flagAngle.x, state.flagSpeed.x, state.flagGust.x, 0);
  };

  return {
    state,
    trim(windRel, level): void {
      const now = clothClock.now();
      const dt = last < 0 ? 0 : clamp(now - last, 0, 2);
      last = now;
      if (!Number.isFinite(windRel) || !Number.isFinite(level)) return; // one bad input must not poison the springs
      input.windRel = windRel;
      input.level = level;
      if (!windGiven) {
        wind.angle = windRel;
        wind.speed = 8;
        wind.gust = 1;
      }
      stepCloth(state, input, dt);
      tickClothTime(now);
      write();
    },
    setWind(next): void {
      if (!Number.isFinite(next.angle) || !Number.isFinite(next.speed) || !Number.isFinite(next.gust)) return;
      windGiven = true;
      wind.angle = next.angle;
      wind.speed = next.speed;
      wind.gust = clamp(next.gust, 0.75, 1.25);
    },
    setDamageHeight(height): void {
      damage = height;
      input.tear = clamp((1 - height) / (1 - MIN_DAMAGE_HEIGHT), 0, 1);
      if (state.ready) write();
    },
  };
}
