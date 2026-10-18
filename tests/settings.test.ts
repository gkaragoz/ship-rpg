import { describe, expect, it } from 'vitest';
import { DEFAULTS, PRESETS, createSettingsStore, defaults, matchPreset, merge, sanitize, urlOverrides, type StorageLike } from '../src/settings';

const memory = (initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
};

describe('sanitize', () => {
  it('returns the defaults for nothing, junk or the wrong types', () => {
    expect(sanitize(undefined)).toEqual(DEFAULTS);
    expect(sanitize(null)).toEqual(DEFAULTS);
    expect(sanitize('x')).toEqual(DEFAULTS);
    expect(sanitize({ graphics: 'high', audio: 5 })).toEqual(DEFAULTS);
  });

  it('keeps valid values, clamps numbers and drops unknown values and keys', () => {
    const s = sanitize({
      graphics: { renderScale: 9, antialias: 'bogus', shadows: 'high', particles: -3, fpsLimit: 60, extra: 1 },
      audio: { master: 2, music: 0.25, muted: true },
      game: { hudScale: 0.1, cameraSensitivity: 1.5 },
      other: {},
    });
    expect(s.graphics.renderScale).toBe(2);
    expect(s.graphics.antialias).toBe(DEFAULTS.graphics.antialias);
    expect(s.graphics.shadows).toBe('high');
    expect(s.graphics.particles).toBe(0.25);
    expect(s.graphics.fpsLimit).toBe(60);
    expect(s.audio).toEqual({ ...DEFAULTS.audio, master: 1, music: 0.25, muted: true });
    expect(s.game.hudScale).toBe(0.7);
    expect(s.game.cameraSensitivity).toBe(1.5);
    expect(s).not.toHaveProperty('other');
    expect(s.graphics).not.toHaveProperty('extra');
  });

  it('rejects NaN and infinities', () => {
    expect(sanitize({ audio: { master: NaN } }).audio.master).toBe(DEFAULTS.audio.master);
    expect(sanitize({ audio: { master: Infinity } }).audio.master).toBe(DEFAULTS.audio.master);
  });
});

describe('presets', () => {
  it('label the matching values, and any other mix is custom', () => {
    for (const name of ['low', 'medium', 'high'] as const) {
      expect(matchPreset({ ...defaults().graphics, ...PRESETS[name] })).toBe(name);
    }
    expect(matchPreset({ ...defaults().graphics, ...PRESETS.high, shadows: 'low' })).toBe('custom');
    // the frame limit and the automatic step-down are not part of a preset
    expect(matchPreset({ ...defaults().graphics, fpsLimit: 60, autoQuality: false })).toBe('medium');
  });

  it('get better from low to high', () => {
    expect(PRESETS.low.renderScale).toBeLessThanOrEqual(PRESETS.high.renderScale);
    expect(PRESETS.low.shadows).toBe('off');
    expect(PRESETS.high.globalIllumination).toBe('ssgi');
    expect(PRESETS.low.particles).toBeLessThan(PRESETS.high.particles);
  });

  it('flip to custom when one value is changed', () => {
    expect(merge(defaults(), { graphics: { shadows: 'low' } }).graphics.preset).toBe('custom');
  });
});

describe('settings store', () => {
  it('starts from the defaults, saves changes, and reloads them', () => {
    const storage = memory();
    const store = createSettingsStore(storage);
    expect(store.get()).toEqual(DEFAULTS);
    store.patch({ audio: { master: 0.3 }, graphics: { shadows: 'off' } });
    expect(store.get().audio.master).toBe(0.3);
    expect(store.get().graphics.preset).toBe('custom');
    const again = createSettingsStore(storage);
    expect(again.get().audio.master).toBe(0.3);
    expect(again.get().graphics.shadows).toBe('off');
  });

  it('notifies subscribers with the change and stops after unsubscribing', () => {
    const store = createSettingsStore(memory());
    const seen: number[] = [];
    const off = store.subscribe((s) => seen.push(s.audio.sfx));
    store.patch({ audio: { sfx: 0.4 } });
    off();
    store.patch({ audio: { sfx: 0.9 } });
    expect(seen).toEqual([0.4]);
  });

  it('does not save changes made with persist = false', () => {
    const storage = memory();
    const store = createSettingsStore(storage);
    store.patch({ graphics: { water: 'low' } }, false);
    expect(store.get().graphics.water).toBe('low');
    expect(createSettingsStore(storage).get().graphics.water).toBe(DEFAULTS.graphics.water);
  });

  it('applies URL overrides for this load only', () => {
    const storage = memory();
    const store = createSettingsStore(storage, '?quality=low&aa=msaa8&debug');
    expect(store.get().graphics.water).toBe('low');
    expect(store.get().graphics.antialias).toBe('msaa8');
    expect(store.get().debug.overlay).toBe(true);
    store.patch({ audio: { music: 0.1 } });
    const later = createSettingsStore(storage);
    expect(later.get().graphics.water).toBe(DEFAULTS.graphics.water);
    expect(later.get().debug.overlay).toBe(false);
    expect(later.get().audio.music).toBe(0.1);
    expect(urlOverrides('?quality=ultra&aa=nope')).toEqual({});
  });

  it('applies a preset, resets to the defaults and survives broken or blocked storage', () => {
    const store = createSettingsStore(memory());
    store.preset('low');
    expect(store.get().graphics.preset).toBe('low');
    expect(store.get().graphics.shadows).toBe('off');
    store.reset();
    expect(store.get()).toEqual(DEFAULTS);
    expect(createSettingsStore(memory({ 'ship-rpg.settings': '{not json' })).get()).toEqual(DEFAULTS);
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const s = createSettingsStore(blocked);
    expect(() => s.patch({ audio: { master: 0.5 } })).not.toThrow();
    expect(s.get().audio.master).toBe(0.5);
  });

  it('reads the water quality the old K key saved', () => {
    expect(createSettingsStore(memory({ 'ship-rpg.quality': 'high' })).get().graphics.water).toBe('high');
    expect(createSettingsStore(memory({ 'ship-rpg.quality': 'bogus' })).get().graphics.water).toBe(DEFAULTS.graphics.water);
  });
});
