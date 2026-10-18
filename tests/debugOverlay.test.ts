import { describe, expect, it } from 'vitest';
import { createProfiler } from '../src/core';
import { profilerLines } from '../src/ui/debugOverlay';
import { gameLines, renderLines } from '../src/app/debugLines';
import { DEFAULTS } from '../src/settings';
import { createGame } from '../src/gameplay';
import { getShipSpec } from '../src/ships';

const stats = (() => {
  let clock = 0;
  const p = createProfiler(() => clock);
  p.frame(0);
  for (let i = 1; i <= 30; i++) {
    p.begin('çizim');
    clock += 4;
    p.end('çizim');
    p.frame(i * 16);
  }
  return p.stats();
})();

describe('profiler panel lines', () => {
  it('shows FPS and the frame time in the short form', () => {
    const lines = profilerLines(stats, 'mini', 50);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('FPS');
    expect(lines[0]).toMatch(/FPS\s+6[23]/);
    expect(lines[1]).toContain('16.00 ms');
  });

  it('adds the percentile, the sections and the heap in the full form', () => {
    const lines = profilerLines(stats, 'full', 50.25);
    expect(lines.join('\n')).toMatch(/p95 16\.0/);
    expect(lines.some((l) => l.startsWith('çizim') && l.includes('4.00 ms'))).toBe(true);
    expect(lines.at(-1)).toBe('JS heap    50.3 MB');
    expect(profilerLines(stats, 'full', null).some((l) => l.includes('heap'))).toBe(false);
  });
});

describe('screen lines', () => {
  it('describes the render cost and the quality in force', () => {
    const lines = renderLines(
      { calls: 120, triangles: 250_000, geometries: 70, textures: 60, samples: 4, hdr: true, composer: true, width: 1920, height: 1080, scale: 1, gpuMs: 6.5 },
      DEFAULTS.graphics,
    );
    const text = lines.join('\n');
    expect(text).toContain('120 çağrı');
    expect(text).toContain('250k üçgen');
    expect(text).toContain('GPU        6.50 ms');
    expect(text).toContain('MSAA 4x');
    expect(text).toContain('1920×1080');
    expect(renderLines({ calls: 1, triangles: 1, geometries: 1, textures: 1, samples: 0, hdr: false, composer: false, width: 1, height: 1, scale: 1, gpuMs: null }, DEFAULTS.graphics).join('\n')).not.toContain('GPU');
  });

  it('counts what is going on in the game', () => {
    const spec = getShipSpec('tartane');
    if (!spec) throw new Error('no tartane');
    const lines = gameLines(createGame(spec).view());
    expect(lines[0]).toMatch(/\d+ düşman\s+12 gemi/);
    expect(lines[1]).toContain('rüzgâr');
  });
});
