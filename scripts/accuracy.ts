/** Debug: hit rate and fire rate of a pairing. `npx vite-node scripts/accuracy.ts brig schooner` */
declare const process: { argv: string[] };
import { enemySide, playerSide, runDuel } from '../src/gameplay';
import { getShipSpec } from '../src/ships';

const [aId = 'brig', bId = 'schooner'] = process.argv.slice(2);
const a = getShipSpec(aId);
const b = getShipSpec(bId);
if (!a || !b) throw new Error('unknown ship');
let shotsA = 0, hitsA = 0, shotsB = 0, hitsB = 0, secs = 0;
const N = 20;
for (let i = 0; i < N; i++) {
  const r = runDuel(playerSide(a), enemySide(b), { seed: i + 1, swapped: i % 2 === 1 });
  shotsA += r.shotsA; hitsA += r.hitsA; shotsB += r.shotsB; hitsB += r.hitsB; secs += r.seconds;
}
console.log(`${a.name} vs ${b.name}: A fired ${Math.round(shotsA / N)} balls/duel, ${((100 * hitsA) / shotsA).toFixed(1)}% hit; B fired ${Math.round(shotsB / N)}, ${((100 * hitsB) / shotsB).toFixed(1)}% hit; mean ${Math.round(secs / N)} s`);
