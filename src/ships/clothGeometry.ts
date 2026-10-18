import * as THREE from 'three';

/**
 * Load-time analysis of the Blender sail meshes, so the cloth shader needs nothing baked into the GLBs.
 *
 * Every sail mesh is a welded quad grid per tier; tiers of one mast are separate grids with a gap between them, so
 * the connected components of the index buffer *are* the tiers. Per vertex this adds two attributes:
 *  - `clothA` = (code, v, u, belly): `code` 1…3 square tier slot (bottom up), 4 fore-and-aft sail, +10 for rigging that
 *    follows a tier (yard, footrope, boltropes); `v` 0 at the foot … 1 at the yard; `u` 0…1 across; `belly` the baked
 *    billow in metres along the sail's normal axis (x for square sails, z for fore-and-aft ones).
 *  - `clothB` = (yTop, height, width, seed): the sail's head line at this vertex, its height and width there, a per-mesh seed.
 * Meshes without the attributes (every LOD1/LOD2 sail, jibs) keep code 0 and are not moved by the shader.
 */
export type SailKind = 'square' | 'aft';

export interface SailTier {
  yBot: number;
  yTop: number;
}

export interface SailAnalysis {
  kind: SailKind;
  /** Tiers bottom to top (one for a fore-and-aft sail). */
  tiers: SailTier[];
}

const CACHE = 'clothAnalysis';

/** Component label of every vertex (union of the triangles' vertices) and the component count. */
export function components(index: ArrayLike<number>, vertexCount: number): { label: Int32Array; count: number } {
  const parent = new Int32Array(vertexCount).map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[i] !== r) {
      const next = parent[i] as number;
      parent[i] = r;
      i = next;
    }
    return r;
  };
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = find(index[t] as number);
    const b = find(index[t + 1] as number);
    const c = find(index[t + 2] as number);
    parent[b] = a;
    parent[find(c)] = a;
  }
  const label = new Int32Array(vertexCount).fill(-1);
  const ids = new Map<number, number>();
  for (let i = 0; i < vertexCount; i++) {
    const r = find(i);
    let id = ids.get(r);
    if (id === undefined) ids.set(r, (id = ids.size));
    label[i] = id;
  }
  return { label, count: ids.size };
}

/**
 * Components of a mesh whose faces do not share vertices (flat-shaded quads): vertices at the same position (to
 * a millimetre) count as one before the triangles are joined.
 */
export function weldedComponents(pos: THREE.BufferAttribute, index: ArrayLike<number>): { label: Int32Array; count: number } {
  const first = new Map<string, number>();
  const canon = new Int32Array(pos.count);
  for (let v = 0; v < pos.count; v++) {
    const key = `${Math.round(pos.getX(v) * 1000)},${Math.round(pos.getY(v) * 1000)},${Math.round(pos.getZ(v) * 1000)}`;
    const f = first.get(key);
    if (f === undefined) first.set(key, v);
    canon[v] = f ?? v;
  }
  const remapped = Array.from(index, (i) => canon[i] as number);
  const { label } = components(remapped, pos.count);
  const out = new Int32Array(pos.count);
  for (let v = 0; v < pos.count; v++) out[v] = label[canon[v] as number] as number;
  return { label: out, count: new Set(out).size };
}

/** Least squares plane `p[axis] = a + b·p[i] + c·p[j]` through the given vertices (their mean when degenerate). */
function fitPlane(pos: THREE.BufferAttribute, verts: number[], axis: number, i: number, j: number): [number, number, number] {
  const get = (v: number, k: number): number => pos.getComponent(v, k);
  let n = 0, si = 0, sj = 0, sa = 0, sii = 0, sjj = 0, sij = 0, sai = 0, saj = 0;
  for (const v of verts) {
    const x = get(v, i), y = get(v, j), z = get(v, axis);
    n++; si += x; sj += y; sa += z; sii += x * x; sjj += y * y; sij += x * y; sai += z * x; saj += z * y;
  }
  const m = [[n, si, sj], [si, sii, sij], [sj, sij, sjj]];
  const rhs = [sa, sai, saj];
  const det3 = (a: number[][]): number =>
    (a[0] as number[])[0]! * ((a[1] as number[])[1]! * (a[2] as number[])[2]! - (a[1] as number[])[2]! * (a[2] as number[])[1]!) -
    (a[0] as number[])[1]! * ((a[1] as number[])[0]! * (a[2] as number[])[2]! - (a[1] as number[])[2]! * (a[2] as number[])[0]!) +
    (a[0] as number[])[2]! * ((a[1] as number[])[0]! * (a[2] as number[])[1]! - (a[1] as number[])[1]! * (a[2] as number[])[0]!);
  const d = det3(m);
  if (Math.abs(d) < 1e-9 * Math.max(1, n)) return [n ? sa / n : 0, 0, 0];
  const solve = (col: number): number => det3(m.map((row, r) => row.map((val, c) => (c === col ? (rhs[r] as number) : val)))) / d;
  return [solve(0), solve(1), solve(2)];
}

/** Vertices on the open boundary of a triangle mesh (edges used by one triangle). */
function boundaryVertices(index: ArrayLike<number>, vertexCount: number): Set<number> {
  const uses = new Map<number, number>();
  const key = (a: number, b: number): number => (a < b ? a * vertexCount + b : b * vertexCount + a);
  for (let t = 0; t + 2 < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const k = key(index[t + e] as number, index[t + ((e + 1) % 3)] as number);
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  const out = new Set<number>();
  for (let t = 0; t + 2 < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[t + e] as number;
      const b = index[t + ((e + 1) % 3)] as number;
      if (uses.get(key(a, b)) === 1) {
        out.add(a);
        out.add(b);
      }
    }
  }
  return out;
}

/** Upper and lower outline of a fore-and-aft sail as functions of x: 24 bins, empty ones filled by interpolation. */
function envelope(pos: THREE.BufferAttribute, xs: [number, number]): { top: number[]; bot: number[] } {
  const bins = 24;
  const top = new Array<number>(bins).fill(-Infinity);
  const bot = new Array<number>(bins).fill(Infinity);
  const span = Math.max(xs[1] - xs[0], 1e-6);
  for (let v = 0; v < pos.count; v++) {
    const b = Math.min(bins - 1, Math.floor(((pos.getX(v) - xs[0]) / span) * bins));
    top[b] = Math.max(top[b] as number, pos.getY(v));
    bot[b] = Math.min(bot[b] as number, pos.getY(v));
  }
  for (const arr of [top, bot]) {
    for (let b = 0; b < bins; b++) {
      if (Number.isFinite(arr[b])) continue;
      let lo = b - 1;
      while (lo >= 0 && !Number.isFinite(arr[lo])) lo--;
      let hi = b + 1;
      while (hi < bins && !Number.isFinite(arr[hi])) hi++;
      arr[b] = lo >= 0 && hi < bins ? ((arr[lo] as number) * (hi - b) + (arr[hi] as number) * (b - lo)) / (hi - lo) : (arr[lo >= 0 ? lo : hi] as number);
    }
  }
  return { top, bot };
}

const sample = (arr: number[], x: number, xs: [number, number]): number => {
  const f = ((x - xs[0]) / Math.max(xs[1] - xs[0], 1e-6)) * arr.length - 0.5;
  const i = Math.min(Math.max(Math.floor(f), 0), arr.length - 2);
  const t = Math.min(Math.max(f - i, 0), 1);
  return (arr[i] as number) * (1 - t) + (arr[i + 1] as number) * t;
};

/**
 * Add the cloth attributes to a sail mesh. `slotOffset` shifts the tier slots up, so a mast with fewer tiers than the
 * ship's tallest uses the upper slots. Returns the analysis (also cached on the geometry, which GLB ships share), or
 * `undefined` for a mesh that is not an indexed grid.
 */
export function prepareSail(geometry: THREE.BufferGeometry, kind: SailKind, seed: number, slotOffset = 0): SailAnalysis | undefined {
  const cached = geometry.userData[CACHE] as SailAnalysis | undefined;
  if (cached) return cached;
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const index = geometry.getIndex();
  if (!pos || !index) return undefined;
  const n = pos.count;
  const { label, count } = components(index.array, n);
  const comps: number[][] = Array.from({ length: kind === 'square' ? count : 1 }, () => []);
  for (let v = 0; v < n; v++) comps[kind === 'square' ? (label[v] as number) : 0]?.push(v);
  const mean = (verts: number[]): number => verts.reduce((a, v) => a + pos.getY(v), 0) / Math.max(verts.length, 1);
  comps.sort((a, b) => mean(a) - mean(b));
  const boundary = boundaryVertices(index.array, n);
  const A = new Float32Array(n * 4);
  const B = new Float32Array(n * 4);
  const tiers: SailTier[] = [];
  const axis = kind === 'square' ? 0 : 2; // belly axis: x for square sails, z for fore-and-aft
  const across = kind === 'square' ? 2 : 0;

  comps.forEach((verts, k) => {
    let yBot = Infinity, yTop = -Infinity, aMin = Infinity, aMax = -Infinity;
    for (const v of verts) {
      yBot = Math.min(yBot, pos.getY(v));
      yTop = Math.max(yTop, pos.getY(v));
      aMin = Math.min(aMin, pos.getComponent(v, across));
      aMax = Math.max(aMax, pos.getComponent(v, across));
    }
    tiers.push({ yBot, yTop });
    const edge = verts.filter((v) => boundary.has(v));
    const [pa, pb, pc] = fitPlane(pos, edge.length >= 4 ? edge : verts, axis, across, 1);
    const env = kind === 'aft' ? envelope(pos, [aMin, aMax]) : undefined;
    const width = Math.max(aMax - aMin, 1e-3);
    for (const v of verts) {
      const y = pos.getY(v);
      const h = pos.getComponent(v, across);
      const top = env ? sample(env.top, h, [aMin, aMax]) : yTop;
      const bot = env ? sample(env.bot, h, [aMin, aMax]) : yBot;
      const height = Math.max(top - bot, 1e-3);
      const baked = pos.getComponent(v, axis) - (pa + pb * h + pc * y);
      A.set([kind === 'square' ? 1 + slotOffset + k : 4, Math.min(Math.max((y - bot) / height, 0), 1), kind === 'aft' ? (aMax - h) / width : (h - aMin) / width, edge.length ? baked : 0], v * 4);
      B.set([top, height, width, seed], v * 4);
    }
  });
  geometry.setAttribute('clothA', new THREE.BufferAttribute(A, 4));
  geometry.setAttribute('clothB', new THREE.BufferAttribute(B, 4));
  const analysis: SailAnalysis = { kind, tiers };
  geometry.userData[CACHE] = analysis;
  return analysis;
}

/**
 * Add the cloth attributes to the yards mesh of a square-sail mast: each part (yard, footrope, boltrope, lift …) is a
 * connected piece and belongs to the tier it starts in; it is then gathered by the shader like that tier's sail
 * (no belly), except the part within a yard's thickness of the head line, so the yards stay where they are.
 */
export function prepareYards(geometry: THREE.BufferGeometry, tiers: SailTier[], seed: number, slotOffset = 0): void {
  if (geometry.getAttribute('clothA')) return;
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const index = geometry.getIndex();
  if (!pos || !index || tiers.length === 0) return;
  const n = pos.count;
  const { label, count } = components(index.array, n);
  const minY = new Float64Array(count).fill(Infinity);
  for (let v = 0; v < n; v++) minY[label[v] as number] = Math.min(minY[label[v] as number] as number, pos.getY(v));
  const tierOf = (y: number): number => {
    let k = 0;
    tiers.forEach((t, i) => {
      if (t.yBot <= y + 0.06) k = i;
    });
    return k;
  };
  const A = new Float32Array(n * 4);
  const B = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const k = tierOf(minY[label[v] as number] as number);
    const t = tiers[k] as SailTier;
    const height = Math.max(t.yTop - t.yBot, 1e-3);
    A.set([11 + slotOffset + k, (pos.getY(v) - t.yBot) / height, 0.5, 0], v * 4);
    B.set([t.yTop, height, 1, seed], v * 4);
  }
  geometry.setAttribute('clothA', new THREE.BufferAttribute(A, 4));
  geometry.setAttribute('clothB', new THREE.BufferAttribute(B, 4));
}
