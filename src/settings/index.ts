export { DEFAULTS, PRESETS, defaults, matchPreset, merge, sanitize, withPreset } from './schema';
export type {
  AntialiasMode, AudioSettings, DebugSettings, DeepPartial, GameSettings, GiMode, GraphicsSettings, LightQuality, OcclusionMode,
  PresetName, Settings, ShadowQuality, TextureQuality, ToneMapping, WaterQuality,
} from './schema';
export { createSettingsStore, getSettings, urlOverrides } from './store';
export type { SettingsStore, StorageLike } from './store';
