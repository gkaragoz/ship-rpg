/**
 * Sailors in the sea: thrown off a ship by a hit or spilled by a sinking, they fly, tumble, land with a splash, swim for
 * a while, tire, and drown. Pure and deterministic (no three.js, no clock): `render/swimmers.ts` draws them. A cheap
 * rag doll: the body is one tumbling point with gravity and drag, and the limbs are flailed by `crewPoses.ts` from the
 * `phase` and the time it has lasted.
 */
export type SwimPhase = 'fly' | 'swim' | 'drown';

export interface Swimmer {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Body yaw, and the tumble (pitch, roll) with its spin rates (rad and rad/s). */
  yaw: number;
  pitch: number;
  roll: number;
  spinPitch: number;
  spinRoll: number;
  phase: SwimPhase;
  /** Seconds in the current phase, and how long it swims before it gives up. */
  t: number;
  swimFor: number;
  /** Seconds left before it is thrown (a sinking ship spills its sailors over a couple of seconds). */
  delay: number;
  /** Heading of its slow swimming and its speed. */
  course: number;
  /** A sailor's own seed for its looks and its stroke. */
  seed: number;
}

/** Longest a sailor swims before it tires and goes under, seconds. */
export const SWIM_TIME = [14, 30] as const;
/** Seconds a drowning sailor takes to go under, and how deep it sinks (m). */
export const DROWN_TIME = 5;
export const DROWN_DEPTH = 3.2;
/** Where the feet are relative to the surface while swimming (the head and shoulders stay out). */
export const FLOAT_DEPTH = 1.15;
export const MAX_SWIMMERS = 48;

const GRAVITY = 9.81;
const AIR_DRAG = 0.08;

export interface SwimEnv {
  /** Height of the sea surface at (x, z). */
  surface(x: number, z: number): number;
  /** A splash: where a sailor hit the water and how fast. */
  splash(x: number, z: number, speed: number): void;
}

/** A tiny deterministic generator for the sim's own choices. */
export function swimRng(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 1;

/** A sailor thrown from (x, y, z) at velocity (vx, vy, vz), after `delay` seconds. */
export function throwSailor(x: number, y: number, z: number, vx: number, vy: number, vz: number, rand: () => number, delay = 0): Swimmer {
  return {
    id: nextId++, x, y, z, vx, vy, vz,
    yaw: Math.atan2(vx, vz), pitch: 0, roll: 0,
    spinPitch: (rand() - 0.5) * 9, spinRoll: (rand() - 0.5) * 7,
    phase: 'fly', t: 0, swimFor: SWIM_TIME[0] + rand() * (SWIM_TIME[1] - SWIM_TIME[0]), delay,
    course: rand() * Math.PI * 2, seed: rand() * 1000,
  };
}

/** Sailors thrown off a hit: one body flung away along (nx, nz) from the point of impact. */
export function flungByHit(x: number, y: number, z: number, nx: number, nz: number, rand: () => number): Swimmer {
  const len = Math.hypot(nx, nz) || 1;
  const speed = 4 + rand() * 5;
  const spread = (rand() - 0.5) * 1.2;
  const c = Math.cos(spread);
  const s = Math.sin(spread);
  const dx = (nx / len) * c - (nz / len) * s;
  const dz = (nx / len) * s + (nz / len) * c;
  return throwSailor(x, y + 0.5, z, dx * speed, 4 + rand() * 4, dz * speed, rand);
}

/** The sailors of a sinking ship, spilled around (x, z) over about two seconds. */
export function spilledBySinking(x: number, y: number, z: number, length: number, count: number, rand: () => number): Swimmer[] {
  const out: Swimmer[] = [];
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * length * 0.35;
    const out1 = 1.5 + rand() * 3.5;
    out.push(throwSailor(x + Math.cos(a) * r, y + rand(), z + Math.sin(a) * r, Math.cos(a) * out1, 2.5 + rand() * 4, Math.sin(a) * out1, rand, rand() * 2));
  }
  return out;
}

/** Advance every swimmer by `dt`; the ones that have drowned are removed (the array is edited in place). */
export function stepSwimmers(list: Swimmer[], env: SwimEnv, dt: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i] as Swimmer;
    if (s.delay > 0) {
      s.delay -= dt;
      continue;
    }
    s.t += dt;
    if (s.phase === 'fly') {
      s.vy -= GRAVITY * dt;
      const drag = Math.exp(-AIR_DRAG * dt);
      s.vx *= drag;
      s.vz *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.pitch += s.spinPitch * dt;
      s.roll += s.spinRoll * dt;
      const sea = env.surface(s.x, s.z);
      if (s.y <= sea + 0.2 && s.vy < 0) {
        env.splash(s.x, s.z, Math.hypot(s.vx, s.vy, s.vz));
        s.phase = 'swim';
        s.t = 0;
        s.vy = 0;
        s.course = Math.atan2(s.vx, s.vz) + (s.seed % 1) * 1.5;
        s.vx *= 0.15;
        s.vz *= 0.15;
      }
    } else {
      // upright again within a second or two (the tumble eases out), carried along slowly, bobbing with the sea
      const settle = Math.exp(-3 * dt);
      s.pitch *= settle;
      s.roll *= settle;
      const speed = s.phase === 'swim' ? 0.45 * (1 - 0.6 * Math.min(s.t / s.swimFor, 1)) : 0.05;
      s.vx += (Math.sin(s.course) * speed - s.vx) * Math.min(1, 2 * dt);
      s.vz += (Math.cos(s.course) * speed - s.vz) * Math.min(1, 2 * dt);
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      s.yaw = s.course;
      let target = env.surface(s.x, s.z) - FLOAT_DEPTH;
      if (s.phase === 'swim' && s.t >= s.swimFor) {
        s.phase = 'drown';
        s.t = 0;
      }
      if (s.phase === 'drown') target -= DROWN_DEPTH * Math.min(s.t / DROWN_TIME, 1) ** 1.5;
      s.y += (target - s.y) * Math.min(1, 6 * dt);
      if (s.phase === 'drown' && s.t > DROWN_TIME) list.splice(i, 1);
    }
  }
}
