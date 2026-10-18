# Balance

Measured with a headless duel simulator (`src/gameplay/duel.ts`): two ships fight on the real sailing, ballistics and damage code, both steered by the enemy AI (a *bot*), seeded, 20 Hz. Regenerate this file with:

```bash
BALANCE_SEEDS=60 npm run balance > docs/BALANCE.md   # then re-add this preface
```

`tests/balance.test.ts` guards the pictures below (win rate, decisiveness, fairness); if you retune, run the report, decide the new picture is intended, and update the test windows and these docs.

## What was tuned (slice 5a.4)

| Constant | Before | Now | Why |
|---|---|---|---|
| `COMBAT.elevationMin/Max` | 0.05 / 0.11 rad | 0.07 / 0.09 | Landing distance was spread over 100–200 m, so a ship 130 m away was hit by ~13% of the balls however well it was placed. Now shots land about 115–150 m out: ~40% of them hit a ship that is in the zone, and the aim zone means something. Median duel length fell from over 7 minutes (most were never decided) to 60–150 s. |
| `ENEMY_TUNING.hullFactor` | 0.7 | 0.8 | With the handicap removed from hull it still gives the bot a 60–100% win rate. |
| `COMBAT.enemyReload` | 10 s | 8 s | Same. |
| `COMBAT.enemySpread` | 1.6× | 1.3× | Same. |
| `COMBAT.damagePerLb` | 2.5 | 2.5 | Unchanged: duels already end in 1–2.5 minutes. |
| `pickEnemySpec` | closest hull to 80% of yours | armed, no more than 1.2× your speed, within 0.45–1.7× your strength (√(hull × broadside damage)), closest to 0.85× | Speed decided fights: a 7-knot Barque lost 88% to a Yacht and a Galleon 93% to a Pinnace, while Corvette, Frigate and Pinnace won ~100%. |
| `CONFIG.giveUpRange/Seconds` | 1500 m / 30 s | 1000 m / 20 s | An enemy can be at most 1.2× faster, so the gap grows slowly: 1.5 km took minutes. |

The simulator also needed fixing before it measured anything: the AI's tie-breaks and the wind favoured whichever side started in the west (a mirror match was 100/0), so each pairing is fought half and half from each side with a small random offset, heading and wind phase per seed. The mirror check below is now 42–58%.

## How to read the tables

- **win** is the bot player winning: the enemy sinks or breaks off (hull below 25%). **loss** is the reverse. **got away** / **enemy got away** are fights where one side was lost from sight for 20 s beyond 1 km; **draw** ran out the 420 s.
- The bot is better at positioning than a human with no practice and worse than a good one: read 60–100% as "winnable, with the enemy usually beaten", not as a promise.
- Slow, heavy ships still have the harder job (turn rate and speed decide who gets the broadside), but the speed rule keeps them from facing a hunter they cannot match. **Tartane has no guns** and cannot win: it must run (its hunter is no faster) or dock, where it is safe.
- Ranks 1 and 2 only appear after 2 and 4 kills. A short pool repeats (Barque, Caravel and Galleon meet the same type again).


Both sides are steered by the enemy AI, so this is a *bot* player: a human with no aim practice does worse, a good one better.
"Player" fights as you do (full hull, 6 s reload, normal spread); the enemy has its handicap (see `ENEMY_HULL_FACTOR`, `COMBAT.enemyReload`, `COMBAT.enemySpread`).

## Player against each of its three enemies

| Player | Enemy | rank | win | loss | got away | enemy got away | draw | median s | hull left |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tartane (7) | Barque (7) | 0 | 0% | 100% | 0% | 0% | 0% | 149 | 5% |
| Tartane (7) | Caravel (8) | 1 | 0% | 100% | 0% | 0% | 0% | 125 | 2% |
| Tartane (7) | Galleon (7) | 2 | 0% | 8% | 0% | 0% | 92% | 420 | 90% |
| Yacht (9) | Yacht (9) | 0 | 72% | 28% | 0% | 0% | 0% | 132 | 57% |
| Yacht (9) | Barque (7) | 1 | 98% | 2% | 0% | 0% | 0% | 127 | 84% |
| Yacht (9) | Sloop (10) | 2 | 48% | 52% | 0% | 0% | 0% | 140 | 41% |
| Lugger (16) | Lugger (16) | 0 | 82% | 18% | 0% | 0% | 0% | 99 | 61% |
| Lugger (16) | Yacht (9) | 1 | 82% | 18% | 0% | 0% | 0% | 142 | 63% |
| Lugger (16) | Barque (7) | 2 | 100% | 0% | 0% | 0% | 0% | 116 | 82% |
| Sloop (10) | Barque (7) | 0 | 100% | 0% | 0% | 0% | 0% | 120 | 86% |
| Sloop (10) | Yacht (9) | 1 | 92% | 8% | 0% | 0% | 0% | 132 | 74% |
| Sloop (10) | Sloop (10) | 2 | 83% | 17% | 0% | 0% | 0% | 153 | 55% |
| Schooner (12) | Xebec (10) | 0 | 82% | 18% | 0% | 0% | 0% | 112 | 60% |
| Schooner (12) | Schooner (12) | 1 | 62% | 38% | 0% | 0% | 0% | 109 | 51% |
| Schooner (12) | Sloop (10) | 2 | 93% | 7% | 0% | 0% | 0% | 121 | 71% |
| Barque (7) | Barque (7) | 0 | 62% | 38% | 0% | 0% | 0% | 132 | 47% |
| Barque (7) | Barque (7) | 1 | 62% | 38% | 0% | 0% | 0% | 132 | 47% |
| Barque (7) | Barque (7) | 2 | 62% | 38% | 0% | 0% | 0% | 132 | 47% |
| Xebec (10) | Xebec (10) | 0 | 73% | 27% | 0% | 0% | 0% | 111 | 56% |
| Xebec (10) | Sloop (10) | 1 | 97% | 3% | 0% | 0% | 0% | 120 | 71% |
| Xebec (10) | Schooner (12) | 2 | 65% | 35% | 0% | 0% | 0% | 118 | 46% |
| Galeoth (13) | Yacht (9) | 0 | 77% | 23% | 0% | 0% | 0% | 123 | 56% |
| Galeoth (13) | Barque (7) | 1 | 97% | 3% | 0% | 0% | 0% | 105 | 78% |
| Galeoth (13) | Galeoth (13) | 2 | 68% | 32% | 0% | 0% | 0% | 97 | 50% |
| Caravel (8) | Caravel (8) | 0 | 70% | 30% | 0% | 0% | 0% | 145 | 57% |
| Caravel (8) | Caravel (8) | 1 | 70% | 30% | 0% | 0% | 0% | 145 | 57% |
| Caravel (8) | Caravel (8) | 2 | 70% | 30% | 0% | 0% | 0% | 145 | 57% |
| Fleut (10.5) | Schooner (12) | 0 | 65% | 35% | 0% | 0% | 0% | 131 | 43% |
| Fleut (10.5) | Xebec (10) | 1 | 73% | 27% | 0% | 0% | 0% | 124 | 56% |
| Fleut (10.5) | Fleut (10.5) | 2 | 87% | 13% | 0% | 0% | 0% | 119 | 62% |
| Brig (14) | Schooner (12) | 0 | 95% | 5% | 0% | 0% | 0% | 101 | 67% |
| Brig (14) | Fleut (10.5) | 1 | 97% | 3% | 0% | 0% | 0% | 99 | 73% |
| Brig (14) | Xebec (10) | 2 | 100% | 0% | 0% | 0% | 0% | 88 | 77% |
| Pinnace (11) | Caravel (8) | 0 | 98% | 2% | 0% | 0% | 0% | 131 | 75% |
| Pinnace (11) | Fleut (10.5) | 1 | 100% | 0% | 0% | 0% | 0% | 119 | 77% |
| Pinnace (11) | Pinnace (11) | 2 | 82% | 18% | 0% | 0% | 0% | 146 | 53% |
| Corvette (16) | Pinnace (11) | 0 | 98% | 2% | 0% | 0% | 0% | 96 | 77% |
| Corvette (16) | Galleon (7) | 1 | 97% | 3% | 0% | 0% | 0% | 99 | 71% |
| Corvette (16) | Corvette (16) | 2 | 75% | 25% | 0% | 0% | 0% | 72 | 47% |
| Galleon (7) | Galleon (7) | 0 | 60% | 40% | 0% | 0% | 0% | 140 | 52% |
| Galleon (7) | Caravel (8) | 1 | 65% | 35% | 0% | 0% | 0% | 152 | 52% |
| Galleon (7) | Galleon (7) | 2 | 60% | 40% | 0% | 0% | 0% | 140 | 52% |
| Frigate (14.7) | Corvette (16) | 0 | 87% | 13% | 0% | 0% | 0% | 64 | 60% |
| Frigate (14.7) | Galleon (7) | 1 | 100% | 0% | 0% | 0% | 0% | 89 | 73% |
| Frigate (14.7) | Frigate (14.7) | 2 | 75% | 25% | 0% | 0% | 0% | 66 | 48% |
| Battleship (12.6) | Battleship (12.6) | 0 | 83% | 17% | 0% | 0% | 0% | 69 | 47% |
| Battleship (12.6) | Frigate (14.7) | 1 | 90% | 10% | 0% | 0% | 0% | 62 | 71% |
| Battleship (12.6) | Battleship (12.6) | 2 | 83% | 17% | 0% | 0% | 0% | 69 | 47% |

## Mirror check: the same ship on both sides, both as the player (should be near 50% each way)

| Ship | a wins | b wins | other |
| --- | --- | --- | --- |
| Tartane | 0% | 0% | 100% |
| Yacht | 53% | 47% | 0% |
| Lugger | 55% | 45% | 0% |
| Sloop | 50% | 50% | 0% |
| Schooner | 42% | 58% | 0% |
| Barque | 55% | 45% | 0% |
| Xebec | 53% | 47% | 0% |
| Galeoth | 55% | 45% | 0% |
| Caravel | 48% | 52% | 0% |
| Fleut | 50% | 50% | 0% |
| Brig | 42% | 58% | 0% |
| Pinnace | 52% | 48% | 0% |
| Corvette | 45% | 55% | 0% |
| Galleon | 53% | 47% | 0% |
| Frigate | 52% | 48% | 0% |
| Battleship | 48% | 52% | 0% |
