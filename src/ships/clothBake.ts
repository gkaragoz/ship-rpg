import * as THREE from 'three';

/**
 * The shared baked flutter field (`tools/cloth/solver.ts` writes `public/models/cloth/flutter.bin`): a texture array of
 * 16 x 12 displacement/slope fields, 32-frame seamless loops, sampled by the sail and flag vertex shaders. One texture
 * serves every ship. While it is missing (not loaded yet, or the files are absent) `uBakeInfo.x` stays 0 and the shaders
 * use their analytic flutter, so the cloth never depends on the network.
 */
export interface BakeMeta {
  version: number;
  format: string;
  width: number;
  height: number;
  frames: number;
  layers: number;
  /** Aspect ratios (height / width) of the sail bands, tall to wide. */
  bands: number[];
  levels: number;
  foldLayer: number;
  flagFirst: number;
  hash: string;
}

/** Uniform objects shared by every cloth material: the texture array and (on, 0, 0, frames). */
export const clothBakeUniforms: { uBake: THREE.IUniform<THREE.DataArrayTexture>; uBakeInfo: THREE.IUniform<THREE.Vector4> } = {
  uBake: { value: placeholder() },
  uBakeInfo: { value: new THREE.Vector4(0, 1, 0, 32) },
};

function placeholder(): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(new Uint16Array(4), 1, 1, 1);
  t.format = THREE.RGBAFormat;
  t.type = THREE.HalfFloatType;
  t.needsUpdate = true;
  return t;
}

/** Make the bake available to every cloth shader (the half-float texels of `flutter.bin`, layer-major). */
export function installClothBake(meta: BakeMeta, data: Uint16Array<ArrayBuffer>): void {
  const tex = new THREE.DataArrayTexture(data, meta.width, meta.height, meta.layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  clothBakeUniforms.uBake.value.dispose();
  clothBakeUniforms.uBake.value = tex;
  clothBakeUniforms.uBakeInfo.value.set(1, 1, 0, meta.frames);
}

/** Back to the analytic flutter (used by tests and when the files fail to load). */
export function clearClothBake(): void {
  clothBakeUniforms.uBakeInfo.value.set(0, 1, 0, 32);
}

export const clothBakeReady = (): boolean => clothBakeUniforms.uBakeInfo.value.x > 0.5;

let pending: Promise<boolean> | undefined;

/**
 * Fetch and install the bake once; resolves to whether it is available. Does nothing outside a browser (tests,
 * scripts), where the analytic flutter stays in use.
 */
export function requestClothBake(base = `${import.meta.env.BASE_URL}models/cloth/`): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  pending ??= (async (): Promise<boolean> => {
    try {
      const [binRes, metaRes] = await Promise.all([fetch(`${base}flutter.bin`), fetch(`${base}flutter.meta.json`)]);
      if (!binRes.ok || !metaRes.ok) throw new Error(`HTTP ${binRes.status}/${metaRes.status}`);
      const meta = (await metaRes.json()) as BakeMeta;
      const bytes = await binRes.arrayBuffer();
      const data = new Uint16Array(bytes);
      if (data.length !== meta.layers * meta.width * meta.height * 4) throw new Error('flutter.bin does not match its meta');
      installClothBake(meta, data);
      return true;
    } catch (err) {
      console.warn('cloth flutter bake not loaded, using the analytic flutter', err);
      return false;
    }
  })();
  return pending;
}

// ---- CPU reference of the shader's sampling (tests compare it with the GLSL maths) -------------------------------------

export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** Bilinear sample of one layer at (u, v) in 0…1 over the grid nodes; returns (z, dz/dx, dz/dy) in `out`. */
export function bakeSample(meta: BakeMeta, data: Uint16Array, layer: number, u: number, v: number, out: [number, number, number]): void {
  const { width: w, height: h } = meta;
  // the shader maps (u, v) so that the grid nodes sit on texel centres: uv = (u * (w - 1) + 0.5) / w
  const x = Math.min(Math.max(u, 0), 1) * (w - 1);
  const y = Math.min(Math.max(v, 0), 1) * (h - 1);
  const x0 = Math.min(Math.floor(x), w - 2);
  const y0 = Math.min(Math.floor(y), h - 2);
  const fx = x - x0;
  const fy = y - y0;
  const per = w * h * 4;
  out[0] = out[1] = out[2] = 0;
  for (let c = 0; c < 3; c++) {
    const t = (xx: number, yy: number): number => halfToFloat(data[layer * per + (yy * w + xx) * 4 + c] as number);
    out[c] = (t(x0, y0) * (1 - fx) + t(x0 + 1, y0) * fx) * (1 - fy) + (t(x0, y0 + 1) * (1 - fx) + t(x0 + 1, y0 + 1) * fx) * fy;
  }
}

/**
 * The shader's `bakeFlutter`: two amplitude levels blended by `flutter` (0…1.2), two frames blended by the fractional
 * frame; `phase` is in frames (time * rate + seed * frames), `band` the sail aspect band.
 */
export function bakeFlutter(meta: BakeMeta, data: Uint16Array, band: number, flutter: number, phase: number, u: number, v: number): [number, number, number] {
  const n = meta.frames;
  const fr = ((phase % n) + n) % n;
  const f0 = Math.floor(fr);
  const f1 = (f0 + 1) % n;
  const w = fr - f0;
  const t = Math.min(Math.max((flutter - 0.4) / 0.6, 0), 1);
  const a0 = Math.min(Math.max(flutter / 0.4, 0), 1) * (1 - t);
  const a1 = t;
  const r: [number, number, number] = [0, 0, 0];
  const s0: [number, number, number] = [0, 0, 0];
  const s1: [number, number, number] = [0, 0, 0];
  const base = band * 2 * n;
  for (const [weight, lvl] of [[a0, 0], [a1, 1]] as const) {
    if (weight <= 0.001) continue;
    bakeSample(meta, data, base + lvl * n + f0, u, v, s0);
    bakeSample(meta, data, base + lvl * n + f1, u, v, s1);
    for (let c = 0; c < 3; c++) r[c] = (r[c] as number) + weight * ((s0[c] as number) * (1 - w) + (s1[c] as number) * w);
  }
  return r;
}
