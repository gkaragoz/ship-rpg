/**
 * Balance report: every player ship against its three enemies, plus a mirror check.
 *
 *   npm run balance                  # 12 seeds per pairing, markdown on stdout
 *   BALANCE_SEEDS=40 npm run balance # more seeds, steadier numbers
 *   npm run balance -- --mirror      # only the mirror check
 */
import preface from './balance-preface.md?raw';
import { enemySide, pickEnemySpec, playerSide, runDuel, type DuelOutcome, type DuelResult } from '../src/gameplay';
import { SHIP_SPECS, type ShipSpec } from '../src/ships';

// Node globals, declared here to keep this script free of @types/node.
declare const process: { env: Record<string, string | undefined>; argv: string[] };

const SEEDS = Number(process.env.BALANCE_SEEDS ?? 12);
const onlyMirror = process.argv.includes('--mirror');
const skipEscape = process.argv.includes('--no-escape');

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const pct = (n: number, total: number): string => `${Math.round((100 * n) / total)}%`;

interface Row {
  wins: number;
  losses: number;
  aEscaped: number;
  bEscaped: number;
  timeouts: number;
  seconds: number;
  hullA: number;
  hit: number;
}

function summarise(results: DuelResult[]): Row {
  const count = (o: DuelOutcome): number => results.filter((r) => r.outcome === o).length;
  return {
    wins: count('a-won') + count('b-broke'),
    losses: count('b-won') + count('a-broke'),
    aEscaped: count('a-escaped'),
    bEscaped: count('b-escaped'),
    timeouts: count('timeout'),
    seconds: median(results.map((r) => r.seconds)),
    hullA: results.reduce((a, r) => a + r.hullA, 0) / results.length,
    hit: results.reduce((a, r) => a + r.hitsA, 0) / Math.max(1, results.reduce((a, r) => a + r.shotsA, 0)),
  };
}

function duels(a: (s: ShipSpec) => ReturnType<typeof playerSide>, aSpec: ShipSpec, b: ReturnType<typeof enemySide>): DuelResult[] {
  // Half the duels start on each side, so no side is favoured by the wind or the AI's tie-breaks.
  return Array.from({ length: SEEDS }, (_, i) => runDuel(a(aSpec), b, { seed: i + 1, swapped: i % 2 === 1 }));
}

const line = (cells: (string | number)[]): string => `| ${cells.join(' | ')} |`;
const started = Date.now();

console.log(preface);
console.log(`Report: ${SEEDS} seeds per pairing.\n`);

if (!onlyMirror) {
  console.log('## Player against each of its three enemies\n');
  console.log(line(['Player', 'Enemy', 'rank', 'win', 'loss', 'got away', 'enemy got away', 'draw', 'median s', 'hull left', 'hit']));
  console.log(line(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---']));
  for (const player of SHIP_SPECS) {
    for (const rank of [0, 1, 2]) {
      const enemy = pickEnemySpec(player, rank);
      const r = summarise(duels(playerSide, player, enemySide(enemy)));
      console.log(
        line([
          `${player.name} (${player.stats.speed})`,
          `${enemy.name} (${enemy.stats.speed})`,
          rank,
          pct(r.wins, SEEDS),
          pct(r.losses, SEEDS),
          pct(r.aEscaped, SEEDS),
          pct(r.bEscaped, SEEDS),
          pct(r.timeouts, SEEDS),
          Math.round(r.seconds),
          pct(r.hullA * 100, 100),
          pct(r.hit * 100, 100),
        ]),
      );
    }
  }
}

console.log('\n## Mirror check: the same ship on both sides, both as the player (should be near 50% each way)\n');
console.log(line(['Ship', 'a wins', 'b wins', 'other']));
console.log(line(['---', '---', '---', '---']));
for (const ship of SHIP_SPECS) {
  const results = Array.from({ length: SEEDS }, (_, i) => runDuel(playerSide(ship), playerSide(ship), { seed: i + 1, swapped: i % 2 === 1 }));
  const r = summarise(results);
  console.log(line([ship.name, pct(r.wins, SEEDS), pct(r.losses, SEEDS), pct(SEEDS - r.wins - r.losses, SEEDS)]));
}

if (!skipEscape && !onlyMirror) {
  console.log('\n## Escape: the player runs from the rank-0 enemy (it hunts, the runner never fires; 600 s)\n');
  console.log('A runner that is faster should get away; at equal or lower speed nobody wins: the chase just goes on (the runner is rarely caught, because a hunter needs a broadside to bear).\n');
  console.log(line(['Runner', 'Hunter', 'got away', 'caught', 'chase goes on']));
  console.log(line(['---', '---', '---', '---', '---']));
  for (const runner of SHIP_SPECS) {
    const hunter = pickEnemySpec(runner, 0);
    const rs = Array.from({ length: Math.min(SEEDS, 20) }, (_, i) =>
      runDuel({ ...playerSide(runner), flees: true }, enemySide(hunter), { seed: i + 1, swapped: i % 2 === 1, maxSeconds: 600 }),
    );
    const n = rs.length;
    const away = rs.filter((r) => r.outcome === 'a-escaped').length;
    const caught = rs.filter((r) => r.outcome === 'b-won').length;
    console.log(line([`${runner.name} (${runner.stats.speed})`, `${hunter.name} (${hunter.stats.speed})`, pct(away, n), pct(caught, n), pct(n - away - caught, n)]));
  }
}
console.error(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
