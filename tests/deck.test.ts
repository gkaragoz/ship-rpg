import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDeck, type ShipModelMeta } from '../src/ships';

/** The real tartane deck profile produced by tools/blender/make_tartane.py. */
const meta = JSON.parse(
  new TextDecoder().decode(readFileSync(new URL('../public/models/ships/tartane.meta.json', import.meta.url))),
) as ShipModelMeta;
const deck = createDeck(meta);

describe('tartane deck (from tartane.meta.json)', () => {
  it('spans the hull and rises toward bow and stern (sheer)', () => {
    expect(deck.minX).toBeCloseTo(-6, 0);
    expect(deck.maxX).toBeCloseTo(6, 0);
    expect(deck.heightAt(0)).toBeLessThan(deck.heightAt(deck.maxX));
    expect(deck.heightAt(0)).toBeLessThan(deck.heightAt(deck.minX));
  });

  it('is widest amidships and never negative', () => {
    expect(deck.halfWidthAt(0)).toBeGreaterThan(1.5);
    for (let x = deck.minX; x <= deck.maxX; x += 0.25) expect(deck.halfWidthAt(x)).toBeGreaterThanOrEqual(0);
  });

  it('keeps the mast and the hatch clear', () => {
    expect(deck.walkable(0.96, 0, 0.2)).toBe(false); // mast
    expect(deck.walkable(1.0, 0.2, 0.2)).toBe(false); // hatch
    expect(deck.walkable(-4.0, 0, 0.2)).toBe(true); // open deck
  });
});
