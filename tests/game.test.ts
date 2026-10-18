import { describe, expect, it } from 'vitest';
import { createGame } from '../src/gameplay';
import { getShipSpec } from '../src/ships';
import { GLB_SHIP_IDS } from '../src/ships/assets';

describe('createGame view', () => {
  const spec = getShipSpec('tartane');
  if (!spec) throw new Error('no tartane');

  it('carries the NPC patrols and, without a loaded GLB deck, an empty crew', () => {
    // No assets are loaded in unit tests, so the ship has no walkable deck and no crew.
    const game = createGame(spec);
    game.update(1 / 60, { rudder: 0, sailStep: 0 });
    const v = game.view();
    expect(v.others).toHaveLength(18); // twelve patrols and six merchants
    expect(new Set(v.others.map((o) => o.id)).size).toBe(18);
    // every patrol sails a real ship that has a GLB model
    for (const o of v.others) {
      expect(getShipSpec(o.specId), o.specId).toBeDefined();
      expect(GLB_SHIP_IDS, o.specId).toContain(o.specId);
    }
    expect(new Set(v.others.map((o) => o.specId)).size).toBeGreaterThanOrEqual(10);
    expect(v.crew).toEqual([]);
  });

  it('moves the patrols with the fixed step', () => {
    const game = createGame(spec);
    const before = game.view().others.map((o) => [o.x, o.z]);
    for (let i = 0; i < 60; i++) game.update(1 / 60, { rudder: 0, sailStep: 0 });
    const after = game.view().others.map((o) => [o.x, o.z]);
    expect(after).not.toEqual(before);
  });
});
