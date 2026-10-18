import * as THREE from 'three';
import { waveHeight } from './waves';

export interface RideState {
  x: number;
  z: number;
  heading: number;
  /** Heel from the simulation (radians, + to starboard); wave roll is added on top. */
  roll: number;
}

const euler = new THREE.Euler(0, 0, 0, 'YZX');

/**
 * Float a ship model on the waves: height from the mean of four samples (bow, stern, both
 * sides), pitch and roll from their slopes. `detail = false` (distant ships) takes one sample
 * and skips pitch/roll, which are not visible at that range.
 */
export function rideWaves(
  model: THREE.Object3D,
  s: RideState,
  dims: { length: number; beam: number },
  time: number,
  windFrom: number,
  ampScale: number,
  detail = true,
  /** 0…1: a sinking ship pitches bow-up, lists and settles by this fraction of its length. */
  sink = 0,
): void {
  const sample = (dx: number, dz: number): number => waveHeight(s.x + dx, s.z + dz, time, windFrom, ampScale);
  if (!detail) {
    model.position.set(s.x, sample(0, 0), s.z);
    euler.set(s.roll, s.heading, 0);
    model.setRotationFromEuler(euler);
    return;
  }
  const c = Math.cos(s.heading);
  const sn = Math.sin(s.heading);
  const hl = dims.length * 0.4;
  const hb = dims.beam * 0.5;
  const bow = sample(c * hl, -sn * hl);
  const stern = sample(-c * hl, sn * hl);
  // Starboard direction in world (x, z) is (sin ψ, cos ψ).
  const stbd = sample(sn * hb, c * hb);
  const port = sample(-sn * hb, -c * hb);
  const pitch = Math.atan2(bow - stern, 2 * hl);
  const waveRoll = Math.atan2(stbd - port, 2 * hb);
  // Positive roll sinks the starboard rail, so lean with the surface: minus the wave slope.
  euler.set(s.roll - waveRoll * 0.6 + sink * 0.6, s.heading, pitch * 0.8 - sink * 0.35);
  model.position.set(s.x, (bow + stern + stbd + port) / 4 - sink * dims.length * 0.45, s.z);
  model.setRotationFromEuler(euler);
}
