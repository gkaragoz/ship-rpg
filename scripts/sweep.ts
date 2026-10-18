/**
 * Parameter sweep: try combinations of combat constants and report how decisive and how fair
 * the duels are. `npx vite-node scripts/sweep.ts`. Not part of the game or the tests.
 */
declare const process: { env: Record<string, string | undefined> };
import { COMBAT, ENEMY_TUNING, pickEnemySpec, playerSide, runDuel, enemySide } from '../src/gameplay';
import { SHIP_SPECS, getShipSpec } from '../src/ships';

const SEEDS = Number(process.env.SEEDS ?? 10);
const SET = ['sloop', 'schooner', 'brig', 'xebec', 'pinnace', 'corvette', 'frigate', 'battleship'].map((id) => getShipSpec(id)!);
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

interface Score {
  mirrorSeconds: number;
  mirrorDecisive: number;
  hit: number;
  botWin: number;
  botLoss: number;
  draw: number;
  botSeconds: number;
}

function measure(): Score {
  const mirrorSecs: number[] = [];
  let decisive = 0;
  let mirrorN = 0;
  let shots = 0;
  let hits = 0;
  for (const s of SET) {
    for (let i = 0; i < SEEDS; i++) {
      const r = runDuel(playerSide(s), playerSide(s), { seed: i + 1, swapped: i % 2 === 1 });
      mirrorSecs.push(r.seconds);
      mirrorN++;
      if (r.outcome !== 'timeout' && r.outcome !== 'a-escaped' && r.outcome !== 'b-escaped') decisive++;
      shots += r.shotsA + r.shotsB;
      hits += r.hitsA + r.hitsB;
    }
  }
  let win = 0, loss = 0, draw = 0, n = 0;
  const botSecs: number[] = [];
  for (const s of SET) {
    const enemy = pickEnemySpec(s, 0);
    for (let i = 0; i < SEEDS; i++) {
      const r = runDuel(playerSide(s), enemySide(enemy), { seed: i + 1, swapped: i % 2 === 1 });
      n++;
      botSecs.push(r.seconds);
      if (r.outcome === 'a-won' || r.outcome === 'b-broke') win++;
      else if (r.outcome === 'b-won' || r.outcome === 'a-broke') loss++;
      else draw++;
    }
  }
  return {
    mirrorSeconds: median(mirrorSecs),
    mirrorDecisive: decisive / mirrorN,
    hit: hits / shots,
    botWin: win / n,
    botLoss: loss / n,
    draw: draw / n,
    botSeconds: median(botSecs),
  };
}

const f = (x: number): string => `${Math.round(x * 100)}%`;
console.log('elev        dmg/lb  ehull espread ereload | mirror: s  decisive  hit | bot: win loss draw  s');
const bands: [number, number][] = [[0.05, 0.11], [0.06, 0.1], [0.07, 0.09]];
const configs: { dmg: number; hull: number; spread: number; reload: number }[] = [];
for (const dmg of [2.5, 4]) {
  for (const [hull, spread, reload] of [[0.7, 1.6, 10], [0.8, 1.3, 8], [1, 1, 6]] as const) configs.push({ dmg, hull, spread, reload });
}
for (const [lo, hi] of bands) {
  for (const c of configs) {
    COMBAT.elevationMin = lo;
    COMBAT.elevationMax = hi;
    COMBAT.damagePerLb = c.dmg;
    ENEMY_TUNING.hullFactor = c.hull;
    COMBAT.enemySpread = c.spread;
    COMBAT.enemyReload = c.reload;
    const s = measure();
    console.log(
      `${lo}-${hi}`.padEnd(11),
      String(c.dmg).padEnd(7),
      String(c.hull).padEnd(5),
      String(c.spread).padEnd(7),
      String(c.reload).padEnd(7),
      `| ${String(Math.round(s.mirrorSeconds)).padStart(4)}   ${f(s.mirrorDecisive).padStart(5)}   ${f(s.hit).padStart(4)}`,
      `| ${f(s.botWin).padStart(4)} ${f(s.botLoss).padStart(4)} ${f(s.draw).padStart(4)} ${String(Math.round(s.botSeconds)).padStart(4)}`,
    );
  }
}
console.log(`ships in set: ${SET.map((s) => s.id).join(', ')}; ${SHIP_SPECS.length} ship types total`);
