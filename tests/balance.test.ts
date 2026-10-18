import { describe, expect, it } from 'vitest';
import { COMBAT, ENEMY_TUNING, MAX_SPEED_RATIO, enemySide, pickEnemySpec, playerSide, runDuel, type DuelResult } from '../src/gameplay';
import { SHIP_SPECS, getShipSpec } from '../src/ships';

/**
 * Balance guard. The numbers behind `docs/BALANCE.md`: a bot fights as the player does against
 * the enemy it would meet, over seeded duels (half starting on each side). If tuning changes
 * make a pairing hopeless, trivial or endless, one of these fails: re-run `npm run balance`,
 * decide whether the new picture is intended, and update the windows below and the docs.
 */
const SEEDS = 10;

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
      const rs = Array.from({ length: 30 }, (_, i) => runDuel(playerSide(s), playerSide(s), { seed: i + 1, swapped: i % 2 === 1 }));
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
    // 10 seeds: one undecided duel is 10 points. The 60-seed report keeps this under 15% (docs/BALANCE.md).
    expect(timeouts, 'undecided duels').toBeLessThanOrEqual(0.25);
    const t = median(rs.map((r) => r.seconds));
    expect(t, 'median seconds to a decision').toBeGreaterThan(40);
    expect(t, 'median seconds to a decision').toBeLessThan(260);
    expect(enemy.stats.speed, 'the enemy is not faster than the player can match').toBeLessThanOrEqual(player.stats.speed * MAX_SPEED_RATIO + 1e-9);
  });
});

describe('an unarmed ship', () => {
  it('has no guns, so it must run or dock: its hunter is the weakest armed ship and no faster than it is', () => {
    const tartane = getShipSpec('tartane')!;
    const squad = [0, 1, 2].map((r) => pickEnemySpec(tartane, r));
    expect(new Set(squad.map((s) => s.id))).toEqual(new Set(['barque'])); // it can never sink anything, so it only ever meets one
    expect(squad[0]!.stats.speed).toBeLessThanOrEqual(tartane.stats.speed * MAX_SPEED_RATIO);
    const rs = fight(playerSide(tartane), enemySide(squad[0]!));
    expect(rs.every((r) => r.shotsA === 0 && r.hitsA === 0)).toBe(true);
    expect(wins(rs)).toBe(0);
  });
});

describe('escape: a chase can be shaken only by being faster', () => {
  const chase = (runner: string, hunter: string, seeds = 12): DuelResult[] =>
    Array.from({ length: seeds }, (_, i) =>
      runDuel({ ...playerSide(getShipSpec(runner)!), flees: true }, enemySide(getShipSpec(hunter)!), { seed: i + 1, swapped: i % 2 === 1, maxSeconds: 600 }),
    );
  const gotAway = (rs: DuelResult[]): number => rs.filter((r) => r.outcome === 'a-escaped').length / rs.length;

  it('a clearly faster runner gets away (Brig 14 from Schooner 12, Lugger 16 from Yacht 9)', () => {
    expect(gotAway(chase('brig', 'schooner'))).toBeGreaterThanOrEqual(0.8);
    expect(gotAway(chase('lugger', 'yacht'))).toBeGreaterThanOrEqual(0.8);
  });

  it('at equal speed the hunter cannot be shaken (Schooner from Schooner, Tartane from Barque)', () => {
    expect(gotAway(chase('schooner', 'schooner'))).toBeLessThanOrEqual(0.2);
    expect(gotAway(chase('tartane', 'barque'))).toBeLessThanOrEqual(0.2);
  });

  it('a slower runner is not shaken either, though it is rarely caught: the chase goes on (Sloop 10 from Galeoth 13)', () => {
    const rs = chase('sloop', 'galeoth');
    expect(gotAway(rs)).toBeLessThanOrEqual(0.2);
  });
});
