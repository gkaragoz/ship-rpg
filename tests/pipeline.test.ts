import { describe, expect, it } from 'vitest';
import { msaaSamples, needsComposer } from '../src/render/pipeline';
import { DEFAULTS, PRESETS, merge } from '../src/settings';

describe('pipeline helpers', () => {
  it('maps each antialiasing mode to its multisample count', () => {
    expect(['off', 'fxaa', 'msaa2', 'msaa4', 'msaa8'].map((m) => msaaSamples(m as never))).toEqual([0, 0, 2, 4, 8]);
  });

  it('skips the post-processing chain only when nothing in it is switched on', () => {
    const plain = merge(DEFAULTS, { graphics: { antialias: 'off', bloom: false, toneMapping: 'none', renderScale: 1 } }).graphics;
    expect(needsComposer(plain)).toBe(false);
    for (const change of [{ antialias: 'fxaa' }, { bloom: true }, { toneMapping: 'aces' }, { renderScale: 0.75 }] as const) {
      expect(needsComposer(merge(DEFAULTS, { graphics: { ...plain, ...change } }).graphics), JSON.stringify(change)).toBe(true);
    }
  });

  it('keeps the default and every preset on the chain (they all antialias or tone map)', () => {
    expect(needsComposer(DEFAULTS.graphics)).toBe(true);
    for (const name of ['low', 'medium', 'high'] as const) {
      expect(needsComposer(merge(DEFAULTS, { graphics: PRESETS[name] }).graphics)).toBe(true);
    }
  });
});
