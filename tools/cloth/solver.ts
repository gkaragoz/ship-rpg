/**
 * Offline cloth bake: a deterministic verlet membrane solver that produces the shared flutter field the sail and flag
 * vertex shaders sample (`src/ships/clothBake.ts`, `public/models/cloth/flutter.bin`).
 *
 * Only `+ - * /`, `sqrt` and `floor` are used (no `Math.sin`, `Math.random`), so every JS engine produces the same
 * bytes. A fixed seed drives the forcing phases. Each field is a 16 x 12 grid of out-of-plane displacement over a
 * sheet normalised to unit area, 32 frames long and seamless (the tail is cross-faded into the head).
 */
export const GRID_W = 16;
export const GRID_H = 12;
export const FRAMES = 32;
/** Aspect (height / width) of the three sail bands: tall, square, wide. */
export const BANDS: readonly number[] = [1.6, 1.0, 0.6];
/** Peak displacement as a fraction of sqrt(width * height) for the gentle and the strong level. */
export const LEVEL_PEAK: readonly number[] = [0.006, 0.02];
export const SEED = 1707;
export const FLAG_ASPECT = 0.25;

/** Layer layout of the texture array. */
export const SAIL_LAYERS = BANDS.length * 2 * FRAMES;
export const FOLD_LAYER = SAIL_LAYERS;
export const FLAG_FIRST = FOLD_LAYER + 1;
export const LAYERS = FLAG_FIRST + 2 * FRAMES;

const TAU = 6.283185307179586;

/** Parabolic sine approximation with one refinement step (max error about 0.001); deterministic everywhere. */
export function psin(x: number): number {
  const t = x - TAU * Math.floor(x / TAU + 0.5);
  const a = t < 0 ? -t : t;
  const y = 1.2732395447351628 * t - 0.4052847345693511 * t * a;
  const ya = y < 0 ? -y : y;
  return 0.225 * (y * ya - y) + y;
}

/** Deterministic generator (mulberry32): integer maths only. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Field {
  /** frames x (GRID_H x GRID_W) displacement */
  z: Float64Array[];
  wp: number;
  hp: number;
}

/**
 * Run the membrane: `z'' = c^2 laplacian(z) - damping z' + forcing` with Verlet integration, edges pinned
 * (`pinned`) or free except the driven left edge (flag), settle, then record `FRAMES` frames and cross-fade the tail.
 */
function simulate(aspect: number, calm: boolean, seed: number, flag: boolean): Field {
  const wp = 1 / Math.sqrt(aspect);
  const hp = Math.sqrt(aspect);
  const dx = wp / (GRID_W - 1);
  const dy = hp / (GRID_H - 1);
  const n = GRID_W * GRID_H;
  const z = new Float64Array(n);
  const prev = new Float64Array(n);
  const next = new Float64Array(n);
  const rand = rng(seed);
  const phase = [rand(), rand(), rand(), rand()];
  const frameDt = 0.05;
  const sub = 4;
  const dt = frameDt / sub;
  const c2 = 4;
  const damp = calm ? 1.1 : 0.55;
  const loop = FRAMES * frameDt;
  const at = (i: number, j: number): number => j * GRID_W + i;

  const force = (i: number, j: number, t: number): number => {
    const xn = i / (GRID_W - 1);
    const yn = j / (GRID_H - 1);
    const tt = t / loop; // cycles of the loop
    const gust = 1 + 0.3 * psin(TAU * (tt + phase[3]!));
    let f = 0.6 * psin(TAU * (2 * xn - 2 * tt + phase[0]!));
    if (!calm) {
      f += 0.5 * psin(TAU * (3 * xn + 1.5 * yn + 3 * tt + phase[1]!));
      f += 0.35 * psin(TAU * (5 * xn - 4 * yn - 4 * tt + phase[2]!));
    }
    return 260 * gust * f;
  };

  const step = (t: number): void => {
    for (let j = 0; j < GRID_H; j++) {
      for (let i = 0; i < GRID_W; i++) {
        const k = at(i, j);
        const edge = i === 0 || j === 0 || i === GRID_W - 1 || j === GRID_H - 1;
        if (flag) {
          if (i === 0) {
            next[k] = psin(TAU * ((t / loop) * (calm ? 2 : 4) + phase[0]!)); // the driven pole edge
            continue;
          }
          const il = i - 1;
          const ir = i === GRID_W - 1 ? i - 1 : i + 1; // free tip: mirror
          const jt = j === 0 ? 1 : j - 1;
          const jb = j === GRID_H - 1 ? j - 1 : j + 1;
          const lap = ((z[at(il, j)] as number) - 2 * (z[k] as number) + (z[at(ir, j)] as number)) / (dx * dx) +
            ((z[at(i, jt)] as number) - 2 * (z[k] as number) + (z[at(i, jb)] as number)) / (dy * dy);
          const vel = (z[k] as number) - (prev[k] as number);
          next[k] = (z[k] as number) + vel * (1 - damp * dt) + dt * dt * (c2 * lap * 0.15);
          continue;
        }
        if (edge) {
          next[k] = 0; // pinned
          continue;
        }
        const lap = ((z[k - 1] as number) - 2 * (z[k] as number) + (z[k + 1] as number)) / (dx * dx) +
          ((z[k - GRID_W] as number) - 2 * (z[k] as number) + (z[k + GRID_W] as number)) / (dy * dy);
        const vel = (z[k] as number) - (prev[k] as number);
        next[k] = (z[k] as number) + vel * (1 - damp * dt) + dt * dt * (c2 * lap + force(i, j, t));
      }
    }
    prev.set(z);
    z.set(next);
  };

  let t = 0;
  const settle = 8 * FRAMES;
  for (let f = 0; f < settle; f++) for (let s = 0; s < sub; s++, t += dt) step(t);
  const extra = 8;
  // `extra` pre-roll frames, then the loop; the tail of the loop fades into the pre-roll so frame N-1 flows into frame 0
  const frames: Float64Array[] = [];
  for (let f = 0; f < extra + FRAMES; f++) {
    frames.push(Float64Array.from(z));
    for (let s = 0; s < sub; s++, t += dt) step(t);
  }
  const out: Float64Array[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const a = frames[extra + f] as Float64Array;
    if (f < FRAMES - extra) {
      out.push(a);
      continue;
    }
    const j = f - (FRAMES - extra);
    const w = (j + 1) / extra;
    const b = frames[j] as Float64Array; // the frame at time j - extra, just before frame 0
    const blended = new Float64Array(n);
    for (let k = 0; k < n; k++) blended[k] = (a[k] as number) * (1 - w) + (b[k] as number) * w;
    out.push(blended);
  }
  return { z: out, wp, hp };
}

/** Scale so the largest |z| over all frames equals `peak`. */
function normalise(field: Field, peak: number): void {
  let m = 0;
  for (const f of field.z) for (const v of f) m = Math.max(m, v < 0 ? -v : v);
  const s = m > 0 ? peak / m : 0;
  for (const f of field.z) for (let k = 0; k < f.length; k++) f[k] = (f[k] as number) * s;
}

/** Write one frame as RGBA texels (z, dz/dx, dz/dy, 0) into `out` at `offset`; slopes in the sheet's physical units. */
function texels(z: Float64Array, wp: number, hp: number, out: Float32Array, offset: number): void {
  const dx = wp / (GRID_W - 1);
  const dy = hp / (GRID_H - 1);
  for (let j = 0; j < GRID_H; j++) {
    for (let i = 0; i < GRID_W; i++) {
      const il = i === 0 ? 0 : i - 1;
      const ir = i === GRID_W - 1 ? i : i + 1;
      const jt = j === 0 ? 0 : j - 1;
      const jb = j === GRID_H - 1 ? j : j + 1;
      const k = (j * GRID_W + i) * 4 + offset;
      out[k] = z[j * GRID_W + i] as number;
      out[k + 1] = ((z[j * GRID_W + ir] as number) - (z[j * GRID_W + il] as number)) / ((ir - il) * dx);
      out[k + 2] = ((z[jb * GRID_W + i] as number) - (z[jt * GRID_W + i] as number)) / ((jb - jt) * dy);
      out[k + 3] = 0;
    }
  }
}

/** Static ruching folds (0..1) with slopes per unit of the normalised (u, v) square: gathered cloth, horizontal creases. */
function foldTexels(out: Float32Array, offset: number): void {
  const rand = rng(SEED + 99);
  const p = rand();
  const f = (u: number, v: number): number => 0.5 + 0.5 * psin(TAU * (3.2 * v + 0.16 * psin(TAU * (2.3 * u + p)) + 0.05 * psin(TAU * (7 * u)) + p));
  const e = 0.01;
  for (let j = 0; j < GRID_H; j++) {
    for (let i = 0; i < GRID_W; i++) {
      const u = i / (GRID_W - 1);
      const v = j / (GRID_H - 1);
      const k = (j * GRID_W + i) * 4 + offset;
      out[k] = f(u, v);
      out[k + 1] = (f(u + e, v) - f(u - e, v)) / (2 * e);
      out[k + 2] = (f(u, v + e) - f(u, v - e)) / (2 * e);
      out[k + 3] = 0;
    }
  }
}

/** The whole bake as float texels, layer-major: sails (band, level, frame), the fold layer, flags (level, frame). */
export function buildBakeTexels(): Float32Array {
  const per = GRID_W * GRID_H * 4;
  const out = new Float32Array(LAYERS * per);
  BANDS.forEach((aspect, b) => {
    for (let level = 0; level < 2; level++) {
      const field = simulate(aspect, level === 0, SEED + b * 10 + level, false);
      normalise(field, (LEVEL_PEAK[level] as number));
      field.z.forEach((z, f) => texels(z, field.wp, field.hp, out, ((b * 2 + level) * FRAMES + f) * per));
    }
  });
  foldTexels(out, FOLD_LAYER * per);
  for (let level = 0; level < 2; level++) {
    const field = simulate(FLAG_ASPECT, level === 0, SEED + 77 + level, true);
    normalise(field, 1);
    field.z.forEach((z, f) => texels(z, field.wp, field.hp, out, (FLAG_FIRST + level * FRAMES + f) * per));
  }
  return out;
}

/** IEEE binary16 bits of `value` (round to nearest even). */
export function toHalf(value: number): number {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = value;
  const x = u32[0] as number;
  const sign = (x >>> 16) & 0x8000;
  const e = (x >>> 23) & 0xff;
  const m = x & 0x7fffff;
  if (e === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  const exp = e - 127 + 15;
  if (exp >= 31) return sign | 0x7c00;
  if (exp <= 0) {
    if (exp < -10) return sign;
    const mm = m | 0x800000;
    const shift = 14 - exp;
    let h = mm >>> shift;
    const rem = mm & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (rem > halfway || (rem === halfway && (h & 1))) h++;
    return sign | h;
  }
  let h = sign | (exp << 10) | (m >>> 13);
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h++;
  return h;
}

export function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** The bake as binary16 values ready to write to `flutter.bin` (little endian). */
export function buildBake(): Uint16Array {
  const t = buildBakeTexels();
  const out = new Uint16Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = toHalf(t[i] as number);
  return out;
}

/** FNV-1a over the bytes (little endian) of the half-float data. */
export function hashBake(data: Uint16Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] as number;
    h = Math.imul(h ^ (v & 0xff), 0x01000193) >>> 0;
    h = Math.imul(h ^ (v >>> 8), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
