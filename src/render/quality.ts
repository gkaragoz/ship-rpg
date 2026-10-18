/**
 * Graphics quality presets. Only things the sea and the renderer can scale cheaply are here:
 * the resolution of the sea mesh and the renderer's pixel-ratio ceiling.
 */
export type QualityName = 'low' | 'medium' | 'high';

export interface Quality {
  name: QualityName;
  /** Cells per side of every clip-map level of the sea mesh (even). */
  grid: number;
  /** Cell size (m) of the finest level; each level further out doubles it. */
  cell: number;
  /** Highest device pixel ratio the renderer uses. */
  pixelRatio: number;
}

export const QUALITIES: Readonly<Record<QualityName, Quality>> = {
  low: { name: 'low', grid: 48, cell: 2, pixelRatio: 1 },
  medium: { name: 'medium', grid: 64, cell: 1.5, pixelRatio: 1.5 },
  high: { name: 'high', grid: 96, cell: 1, pixelRatio: 2 },
};

export const QUALITY_ORDER: readonly QualityName[] = ['low', 'medium', 'high'];

export const isQuality = (v: unknown): v is QualityName => typeof v === 'string' && v in QUALITIES;

/** The next preset, wrapping from the highest to the lowest (the quality key). */
export function nextQuality(q: QualityName): QualityName {
  const i = QUALITY_ORDER.indexOf(q);
  return QUALITY_ORDER[(i + 1) % QUALITY_ORDER.length] ?? 'medium';
}

/** One preset lower, or the same when already the lowest. */
export function lowerQuality(q: QualityName): QualityName {
  return QUALITY_ORDER[Math.max(0, QUALITY_ORDER.indexOf(q) - 1)] ?? 'low';
}

/** Quality for a start-up: an explicit `?quality=` wins, then the saved choice, then medium. */
export function initialQuality(search: string, saved: string | null): { quality: QualityName; fixed: boolean } {
  const asked = new URLSearchParams(search).get('quality');
  if (isQuality(asked)) return { quality: asked, fixed: true };
  return { quality: isQuality(saved) ? saved : 'medium', fixed: false };
}

/** Frame-time window length (s) and the frame time (ms) above which the quality steps down. */
const WINDOW_SECONDS = 2;
const SLOW_MS = 1000 / 40;
const COOLDOWN_SECONDS = 4;

/**
 * Watches frame times and says when to drop one preset: when a whole window averages slower than
 * 40 fps, then not again for a few seconds so the new setting can show its effect. It never raises
 * the quality by itself.
 */
export interface AutoQuality {
  /** Feed one frame's duration in seconds; true when the quality should step down now. */
  frame(dt: number): boolean;
  /** Smoothed frame time in ms over the last window. */
  readonly frameMs: number;
}

export function createAutoQuality(): AutoQuality {
  let time = 0;
  let frames = 0;
  let cooldown = COOLDOWN_SECONDS;
  let ms = 0;
  return {
    get frameMs(): number {
      return ms;
    },
    frame(dt): boolean {
      if (!(dt > 0) || dt > 0.5) return false; // a stall (tab switch, load) says nothing about the scene
      time += dt;
      frames++;
      cooldown = Math.max(0, cooldown - dt);
      if (time < WINDOW_SECONDS) return false;
      ms = (time / frames) * 1000;
      time = 0;
      frames = 0;
      if (ms > SLOW_MS && cooldown <= 0) {
        cooldown = COOLDOWN_SECONDS;
        return true;
      }
      return false;
    },
  };
}
