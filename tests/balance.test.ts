import { describe, expect, it } from 'vitest';
import { COMBAT, ENEMY_TUNING, MAX_SPEED_RATIO, enemySide, pickEnemySpec, playerSide, runDuel, type DuelResult } from '../src/gameplay';
import { SHIP_SPECS, getShipSpec } from '../src/ships';

/**
 * Balance guard. The numbers behind `docs/BALANCE.md`: a bot fights as the player does against
 * the enemy it would meet, over seeded duels (half starting on each side). If tuning changes
 * make a pairing hopeless, trivial or endless, one of these fails: re-run `npm run balance`,
 * decide whether the new picture is intended, and update the windows below and the docs.
 */
const SEEDS = 14;

const fight = (a: ReturnType<typeof playerSide>, b: ReturnType<typeof enemySide>): DuelResult[] =>
  Array.from({ length: SEEDS }, (_, i) => runDuel(a, b, { seed: i + 1, swapped: i % 2 === 1 }));

const wins = (rs: DuelResult[]): number =>
  rs.filter((r) => r.outcome === 'a-won' || r.outcome === 'b-broke').length / rs.length;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

describe('tuning constants', () => {
  it('match the numbers documented in GAME_DESIGN.md and BALANCE.md', () => {
    expect(COMBAT.elevationMin).toBe(0.07);
    expect(COMBAT.elevationMax).toBe(0.09);
    expect(COMBAT.damagePerLb).toBe(2.5);
    expect(COMBAT.playerReload).toBe(6);
    expect(COMBAT.enemyReload).toBe(8);
    expect(COMBAT.enemySpread).toBe(1.3);
    expect(ENEMY_TUNING.hullFactor).toBe(0.8);
    expect(MAX_SPEED_RATIO).toBe(1.2);
  });
});

describe('duels are decisive and fair', () => {
  it('a mirror match is a coin flip, whichever side it starts on', () => {
    for (const id of ['brig', 'frigate', 'galleon']) {
      const s = getShipSpec(id)!;
      const rs = Array.from({ length: 40 }, (_, i) => runDuel(playerSide(s), playerSide(s), { seed: i + 1, swapped: i % 2 === 1 }));
      const aWins = rs.filter((r) => r.outcome === 'a-won' || r.outcome === 'b-broke').length / rs.length;
      expect(aWins, id).toBeGreaterThan(0.25);
      expect(aWins, id).toBeLessThan(0.75);
    }
  });

  it('is reproducible: the same seed gives the same fight', () => {
    const a = playerSide(getShipSpec('brig')!);
    const b = enemySide(getShipSpec('schooner')!);
    expect(runDuel(a, b, { seed: 5 })).toEqual(runDuel(a, b, { seed: 5 }));
    expect(runDuel(a, b, { seed: 5 })).not.toEqual(runDuel(a, b, { seed: 6 }));
  });

  it('swapping the starting sides changes the geometry but not who the ships are', () => {
    const a = playerSide(getShipSpec('brig')!);
    const b = enemySide(getShipSpec('schooner')!);
    expect(runDuel(a, b, { seed: 5, swapped: true })).not.toEqual(runDuel(a, b, { seed: 5 }));
  });
});

describe.each(SHIP_SPECS.filter((s) => s.stats.cannons > 0).map((s) => [s.id, s] as const))('%s against its squadron', (_id, player) => {
  it.each([0, 1, 2])('rank %i: winnable, not a walkover, and decided in a sensible time', (rank) => {
    const enemy = pickEnemySpec(player, rank);
    const rs = fight(playerSide(player), enemySide(enemy));
    const w = wins(rs);
    expect(w, `win rate vs ${enemy.id}`).toBeGreaterThanOrEqual(0.4);
    const timeouts = rs.filter((r) => r.outcome === 'timeout').length / rs.length;
    expect(timeouts, 'undecided duels').toBeLessThanOrEqual(0.15);
    const t = median(rs.map((r) => r.seconds));
    expect(t, 'median seconds to a decision').toBeGreaterThan(40);
    expect(t, 'median seconds to a decision').toBeLessThan(260);
    expect(enemy.stats.speed).toBeLessThanOrEqual(Math.max(player.stats.speed * MAX_SPEED_RATIO, 8));
  });
});

describe('an unarmed ship', () => {
  it('cannot win a fight (it has no guns), so it must run or dock: its hunter is no faster than it is', () => {
    const tartane = getShipSpec('tartane')!;
    const enemy = pickEnemySpec(tartane);
    expect(enemy.stats.speed).toBeLessThanOrEqual(tartane.stats.speed * MAX_SPEED_RATIO);
    expect(wins(fight(playerSide(tartane), enemySide(enemy)))).toBe(0);
  });
});
