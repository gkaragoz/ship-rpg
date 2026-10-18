import { describe, expect, it } from 'vitest';
import { SEA_REACH, gridGeometry, holeCells, levelCell, levelCount, seaTriangles, snap } from '../src/render/oceanMesh';
import { QUALITIES, QUALITY_ORDER, createAutoQuality, initialQuality, lowerQuality, nextQuality } from '../src/render/quality';

describe('sea clip-map', () => {
  it('reaches past the fog on every preset with well under the old 462k sea triangles', () => {
    for (const name of QUALITY_ORDER) {
      const q = QUALITIES[name];
      const n = levelCount(q);
      expect((q.grid * levelCell(q, n - 1)) / 2).toBeGreaterThanOrEqual(SEA_REACH);
      expect(seaTriangles(q), name).toBeLessThan(120_000);
    }
    // finer presets draw more
    expect(seaTriangles(QUALITIES.low)).toBeLessThan(seaTriangles(QUALITIES.medium));
    expect(seaTriangles(QUALITIES.medium)).toBeLessThan(seaTriangles(QUALITIES.high));
  });

  it('builds a full grid and a ring whose triangle counts match the budget', () => {
    const q = QUALITIES.medium;
    const full = gridGeometry(q.grid);
    const ring = gridGeometry(q.grid, holeCells(q));
    expect((full.getIndex()?.count ?? 0) / 3).toBe(2 * q.grid * q.grid);
    expect((ring.getIndex()?.count ?? 0) / 3).toBe(2 * (q.grid * q.grid - holeCells(q) ** 2));
    expect(2 * q.grid * q.grid + (levelCount(q) - 1) * (ring.getIndex()?.count ?? 0) / 3).toBe(seaTriangles(q));
  });

  it('faces up and stays centred on the origin', () => {
    const g = gridGeometry(8);
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    if (!idx) throw new Error('no index');
    for (let t = 0; t < idx.count; t += 3) {
      const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      const e1 = [pos.getX(b) - pos.getX(a), pos.getZ(b) - pos.getZ(a)] as const;
      const e2 = [pos.getX(c) - pos.getX(a), pos.getZ(c) - pos.getZ(a)] as const;
      // normal y component of e1 x e2 in the x-z plane (x right, z down): positive means facing +y
      expect(e1[1] * e2[0] - e1[0] * e2[1]).toBeGreaterThan(0);
    }
    g.computeBoundingBox();
    expect(g.boundingBox?.min.x).toBe(-4);
    expect(g.boundingBox?.max.z).toBe(4);
  });

  it('leaves the hole exactly inside the finer level, with an overlap', () => {
    for (const name of QUALITY_ORDER) {
      const q = QUALITIES[name];
      // the inner level extends ±grid·cell/2; the outer hole ±holeCells·(2·cell)/2 = ±(grid/2 − 2)·cell
      const innerReach = (q.grid * q.cell) / 2;
      const holeReach = (holeCells(q) * levelCell(q, 1)) / 2;
      expect(innerReach - holeReach).toBeGreaterThanOrEqual(q.cell * 2 - 1e-9);
      expect(holeCells(q) % 2).toBe(0);
    }
  });

  it('snaps each level to its own cell size', () => {
    expect(snap(10.4, 2)).toBe(10);
    expect(snap(11.2, 3)).toBe(12);
    expect(snap(-4.9, 3)).toBe(-6);
  });
});

describe('quality presets', () => {
  it('cycles low -> medium -> high -> low and steps down without going below low', () => {
    expect(nextQuality('low')).toBe('medium');
    expect(nextQuality('high')).toBe('low');
    expect(lowerQuality('high')).toBe('medium');
    expect(lowerQuality('low')).toBe('low');
  });

  it('prefers ?quality=, then the saved choice, then medium', () => {
    expect(initialQuality('?quality=high', 'low')).toEqual({ quality: 'high', fixed: true });
    expect(initialQuality('?perf', 'low')).toEqual({ quality: 'low', fixed: false });
    expect(initialQuality('?quality=bogus', 'nonsense')).toEqual({ quality: 'medium', fixed: false });
  });

  it('steps down only after a slow window and then waits', () => {
    const auto = createAutoQuality();
    let drops = 0;
    for (let i = 0; i < 25 * 12; i++) if (auto.frame(1 / 25)) drops++; // 25 fps for 12 s
    expect(drops).toBeGreaterThanOrEqual(1);
    expect(drops).toBeLessThanOrEqual(3);
    const fast = createAutoQuality();
    for (let i = 0; i < 60 * 12; i++) expect(fast.frame(1 / 60)).toBe(false);
    expect(fast.frameMs).toBeCloseTo(16.7, 0);
    const stalls = createAutoQuality();
    for (let i = 0; i < 100; i++) expect(stalls.frame(2)).toBe(false); // tab-switch stalls are ignored
  });
});
