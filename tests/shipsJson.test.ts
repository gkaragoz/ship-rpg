import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHIP_SPECS } from '../src/ships';

describe('tools/blender/ships.json', () => {
  it('is in sync with src/ships/specs.ts (run `npm run export:specs` if this fails)', () => {
    const json = JSON.parse(new TextDecoder().decode(readFileSync(new URL('../tools/blender/ships.json', import.meta.url))));
    expect(json).toEqual(JSON.parse(JSON.stringify(SHIP_SPECS)));
  });
});
