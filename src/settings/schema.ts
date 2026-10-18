import { clamp } from '../core';

/** Water quality presets (mesh resolution, wake map): the sea of `render/quality.ts`. */
export type WaterQuality = 'low' | 'medium' | 'high';
export type PresetName = 'low' | 'medium' | 'high' | 'custom';
export type AntialiasMode = 'off' | 'fxaa' | 'msaa2' | 'msaa4' | 'msaa8';
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high';
export type LightQuality = 'low' | 'medium' | 'high';
export type TextureQuality = 'low' | 'medium' | 'high';
export type OcclusionMode = 'off' | 'ssao' | 'gtao';
export type GiMode = 'off' | 'sky' | 'ssgi';

export interface GraphicsSettings {
  /** The preset these values match; `custom` once any one is changed away from every preset. */
  preset: PresetName;
  /** Sea mesh and wake map resolution. */
  water: WaterQuality;
  /** Render resolution as a fraction of the window (0.5 … 2). */
  renderScale: number;
  antialias: AntialiasMode;
  shadows: ShadowQuality;
  /** How far the sun's shadows reach, as a fraction of the default (0.5 … 1.5). */
  shadowDistance: number;
  /** Dynamic lamps (ship lanterns, fires) that light the night, and sun glints. */
  lights: LightQuality;
  /** Texture filtering and the size of the sea's detail and depth textures. */
  textures: TextureQuality;
  ambientOcclusion: OcclusionMode;
  globalIllumination: GiMode;
  bloom: boolean;
  /** Fog and sea reach as a fraction of the default (0.5 … 1.5). */
  viewDistance: number;
  /** Share of spray, smoke and rain particles drawn (0.25 … 1). */
  particles: number;
  /** Frames per second ceiling; 0 draws as fast as the display allows. */
  fpsLimit: 0 | 30 | 60 | 90 | 144;
  /** Lower the water quality by itself when the frame rate stays low. */
  autoQuality: boolean;
}

export interface AudioSettings {
  master: number;
  sfx: number;
  ambience: number;
  music: number;
  muted: boolean;
}

export interface GameSettings {
  /** Size of the sailing HUD (0.7 … 1.5). */
  hudScale: number;
  showHints: boolean;
  /** Camera orbit and zoom speed (0.4 … 2). */
  cameraSensitivity: number;
}

export interface DebugSettings {
  overlay: boolean;
  detail: 'mini' | 'full';
}

export interface Settings {
  version: 1;
  graphics: GraphicsSettings;
  audio: AudioSettings;
  game: GameSettings;
  debug: DebugSettings;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** What a preset sets: everything but the label itself, `autoQuality` and `fpsLimit`, which stay as chosen. */
type PresetValues = Omit<GraphicsSettings, 'preset' | 'autoQuality' | 'fpsLimit'>;

export const PRESETS: Readonly<Record<'low' | 'medium' | 'high', PresetValues>> = {
  low: {
    water: 'low', renderScale: 0.75, antialias: 'fxaa', shadows: 'off', shadowDistance: 0.7, lights: 'low', textures: 'low',
    ambientOcclusion: 'off', globalIllumination: 'off', bloom: false, viewDistance: 0.7, particles: 0.5,
  },
  medium: {
    water: 'medium', renderScale: 1, antialias: 'msaa4', shadows: 'medium', shadowDistance: 1, lights: 'medium', textures: 'medium',
    ambientOcclusion: 'ssao', globalIllumination: 'sky', bloom: true, viewDistance: 1, particles: 0.8,
  },
  high: {
    water: 'high', renderScale: 1, antialias: 'msaa4', shadows: 'high', shadowDistance: 1.3, lights: 'high', textures: 'high',
    ambientOcclusion: 'gtao', globalIllumination: 'ssgi', bloom: true, viewDistance: 1.2, particles: 1,
  },
};

export const DEFAULTS: Settings = {
  version: 1,
  graphics: { preset: 'medium', ...PRESETS.medium, fpsLimit: 0, autoQuality: true },
  audio: { master: 0.8, sfx: 1, ambience: 0.8, music: 0.6, muted: false },
  game: { hudScale: 1, showHints: true, cameraSensitivity: 1 },
  debug: { overlay: false, detail: 'full' },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const defaults = (): Settings => clone(DEFAULTS);

const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** The preset whose values `g` matches exactly, or `custom`. */
export function matchPreset(g: GraphicsSettings): PresetName {
  for (const name of ['low', 'medium', 'high'] as const) {
    const p = PRESETS[name];
    if ((Object.keys(p) as (keyof PresetValues)[]).every((k) => g[k] === p[k])) return name;
  }
  return 'custom';
}

/**
 * Turn whatever was saved (or typed in the URL) into valid settings: unknown keys are dropped, wrong types and
 * out-of-range numbers fall back to the default or are clamped. Never throws.
 */
export function sanitize(raw: unknown): Settings {
  const d = DEFAULTS;
  const root = obj(raw);
  const g = obj(root.graphics);
  const a = obj(root.audio);
  const p = obj(root.game);
  const b = obj(root.debug);
  const graphics: GraphicsSettings = {
    preset: 'custom',
    water: oneOf(g.water, ['low', 'medium', 'high'], d.graphics.water),
    renderScale: num(g.renderScale, 0.5, 2, d.graphics.renderScale),
    antialias: oneOf(g.antialias, ['off', 'fxaa', 'msaa2', 'msaa4', 'msaa8'], d.graphics.antialias),
    shadows: oneOf(g.shadows, ['off', 'low', 'medium', 'high'], d.graphics.shadows),
    shadowDistance: num(g.shadowDistance, 0.5, 1.5, d.graphics.shadowDistance),
    lights: oneOf(g.lights, ['low', 'medium', 'high'], d.graphics.lights),
    textures: oneOf(g.textures, ['low', 'medium', 'high'], d.graphics.textures),
    ambientOcclusion: oneOf(g.ambientOcclusion, ['off', 'ssao', 'gtao'], d.graphics.ambientOcclusion),
    globalIllumination: oneOf(g.globalIllumination, ['off', 'sky', 'ssgi'], d.graphics.globalIllumination),
    bloom: bool(g.bloom, d.graphics.bloom),
    viewDistance: num(g.viewDistance, 0.5, 1.5, d.graphics.viewDistance),
    particles: num(g.particles, 0.25, 1, d.graphics.particles),
    fpsLimit: oneOf(g.fpsLimit, [0, 30, 60, 90, 144], d.graphics.fpsLimit),
    autoQuality: bool(g.autoQuality, d.graphics.autoQuality),
  };
  graphics.preset = matchPreset(graphics);
  return {
    version: 1,
    graphics,
    audio: {
      master: num(a.master, 0, 1, d.audio.master),
      sfx: num(a.sfx, 0, 1, d.audio.sfx),
      ambience: num(a.ambience, 0, 1, d.audio.ambience),
      music: num(a.music, 0, 1, d.audio.music),
      muted: bool(a.muted, d.audio.muted),
    },
    game: {
      hudScale: num(p.hudScale, 0.7, 1.5, d.game.hudScale),
      showHints: bool(p.showHints, d.game.showHints),
      cameraSensitivity: num(p.cameraSensitivity, 0.4, 2, d.game.cameraSensitivity),
    },
    debug: { overlay: bool(b.overlay, d.debug.overlay), detail: oneOf(b.detail, ['mini', 'full'], d.debug.detail) },
  };
}

/** `base` with `patch` laid over it, group by group, then sanitized (so the preset label stays honest). */
export function merge(base: Settings, patch: DeepPartial<Settings>): Settings {
  const out = clone(base) as unknown as Record<string, Record<string, unknown>>;
  for (const [group, values] of Object.entries(patch)) {
    if (group === 'version' || !values || typeof values !== 'object') continue;
    out[group] = { ...out[group], ...(values as Record<string, unknown>) };
  }
  return sanitize(out);
}

/** `base` with a graphics preset applied (`autoQuality` and `fpsLimit` are kept). */
export function withPreset(base: Settings, name: 'low' | 'medium' | 'high'): Settings {
  return merge(base, { graphics: { ...PRESETS[name] } });
}
