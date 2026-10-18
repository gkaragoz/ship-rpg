import { describe, expect, it } from 'vitest';
import { COMBAT } from '../src/gameplay';
import { casualties, crewFactor, playerReloadSeconds } from '../src/gameplay/company';
import { PROGRESSION, boardingBonus, levelFor, levelProgress, lootBonus, reloadBonus, xpForKill, xpToReach } from '../src/gameplay/progression';

describe('captain levels', () => {
  it('start at level 1 and rise monotonically to the cap', () => {
    expect(levelFor(0)).toBe(1);
    let last = 0;
    for (let l = 2; l <= PROGRESSION.maxLevel; l++) {
      expect(xpToReach(l)).toBeGreaterThan(last);
      last = xpToReach(l);
      expect(levelFor(xpToReach(l))).toBe(l);
      expect(levelFor(xpToReach(l) - 1)).toBe(l - 1);
    }
    expect(levelFor(1e9)).toBe(PROGRESSION.maxLevel);
  });

  it('reports progress inside a level', () => {
    expect(levelProgress(0)).toEqual({ level: 1, into: 0, span: xpToReach(2) });
    expect(levelProgress(xpToReach(3) + 5)).toMatchObject({ level: 3, into: 5 });
    expect(levelProgress(1e9).span).toBe(0);
  });

  it('level 1 is neutral, higher levels help a little', () => {
    expect(reloadBonus(1)).toBe(1);
    expect(lootBonus(1)).toBe(1);
    expect(boardingBonus(1)).toBe(1);
    expect(reloadBonus(10)).toBeLessThan(1);
    expect(lootBonus(10)).toBeGreaterThan(1);
  });

  it('boarding a ship earns more than sinking it', () => {
    expect(xpForKill(700, true)).toBeGreaterThan(xpForKill(700));
    expect(xpForKill(0)).toBe(0);
  });
});

describe('company', () => {
  it('reloads in exactly the base time with a full crew at level 1 (the balance tables assume it)', () => {
    expect(playerReloadSeconds(160, 160, 1)).toBe(COMBAT.playerReload);
    expect(playerReloadSeconds(500, 160, 1)).toBe(COMBAT.playerReload);
  });

  it('reloads slower with a short crew, bounded, and faster with levels', () => {
    expect(playerReloadSeconds(80, 160, 1)).toBeCloseTo(COMBAT.playerReload * 2);
    expect(playerReloadSeconds(0, 160, 1)).toBeCloseTo(COMBAT.playerReload / 0.3);
    expect(playerReloadSeconds(160, 160, 10)).toBeLessThan(COMBAT.playerReload);
    expect(crewFactor(10, 0)).toBe(1);
  });

  it('kills sailors in proportion to the damage, fewer for rigging hits, never more than there are', () => {
    expect(casualties(250, 2500, 160, 'hull')).toBeCloseTo(9.6);
    expect(casualties(250, 2500, 160, 'rigging')).toBeLessThan(casualties(250, 2500, 160, 'hull'));
    expect(casualties(1e6, 2500, 12, 'hull')).toBe(12);
  });
});
