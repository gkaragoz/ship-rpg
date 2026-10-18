/** Debug: can a fleeing ship shake a hunter? `npx vite-node scripts/chase.ts brig schooner` (runner first, hunter second). */
declare const process: { argv: string[] };
import { enemySide, playerSide, runDuel } from '../src/gameplay';
import { getShipSpec } from '../src/ships';

const [runnerId = 'brig', hunterId = 'schooner'] = process.argv.slice(2);
const runner = getShipSpec(runnerId);
const hunter = getShipSpec(hunterId);
if (!runner || !hunter) throw new Error('unknown ship');
const N = 40;
const counts: Record<string, number> = {};
let secs = 0;
for (let i = 0; i < N; i++) {
  const r = runDuel({ ...playerSide(runner), flees: true }, enemySide(hunter), { seed: i + 1, swapped: i % 2 === 1, maxSeconds: 600 });
  counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  secs += r.seconds;
}
console.log(`${runner.name} (${runner.stats.speed}) runs from ${hunter.name} (${hunter.stats.speed}):`, counts, `mean ${Math.round(secs / N)} s`);
