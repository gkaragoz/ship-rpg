# Balance

Measured with a headless duel simulator (`src/gameplay/duel.ts`): two ships fight on the real sailing, ballistics and damage code, both steered by the enemy AI (a *bot*), seeded, at 20 Hz. **This file is generated**: edit `scripts/balance-preface.md` (this text) or `scripts/balance.ts` (the tables) and regenerate with

```bash
BALANCE_SEEDS=60 npm run balance > docs/BALANCE.md
```

## Targets (what `tests/balance.test.ts` enforces)

| Check | Window |
|---|---|
| a bot player against each of its three enemies | wins at least 40%, typically 60–100% |
| fights left undecided after 420 s | at most 15% in the 60-seed report; the 10-seed test allows 25% (one duel is 10 points) |
| median time to a decision | 40–260 s (the tables show 60–160 s) |
| a mirror match (same ship on both sides) | 25–75% for each side (the table shows 42–58%) |
| enemy speed | at most 1.2× the player's |
| a fleeing player that is faster than its hunter | gets away (see "Escape" below) |

There is deliberately no upper bound on the win rate yet: strong ships (Brig, Corvette, Frigate, Pinnace) beat their enemies 90–100% as a bot, which is acceptable for a first pass because a human plays worse than the bot. When a human playtest says otherwise, add one.

## What was tuned (slice 5a.4) and what the numbers say

The parameter sweep below (`npm run balance:sweep`, 8 ships against their rank-0 enemy, 10 seeds each, bot player) is the evidence. "mirror" is the same ship on both sides, "bot" is the player bot against the enemy with the given handicap.

```
elev        dmg/lb  ehull espread ereload | mirror: s  decisive  hit | bot: win loss draw  s
0.05-0.11   2.5     0.7   1.6     10      |  134    100%    26% |  99%   1%   0%  116
0.05-0.11   2.5     0.8   1.3     8       |  134    100%    26% |  91%   9%   0%  126
0.05-0.11   2.5     1     1       6       |  134    100%    26% |  71%  29%   0%  132
0.05-0.11   4       0.8   1.3     8       |  105    100%    25% |  86%  14%   0%  100
0.06-0.1    2.5     0.8   1.3     8       |  109    100%    35% |  88%  13%   0%  108
0.06-0.1    2.5     1     1       6       |  109    100%    35% |  64%  36%   0%  112
0.07-0.09   2.5     0.7   1.6     10      |   99    100%    39% |  93%   8%   0%   98
0.07-0.09   2.5     0.8   1.3     8       |   99    100%    39% |  86%  14%   0%  101   <- chosen
0.07-0.09   2.5     1     1       6       |   99    100%    39% |  63%  38%   0%  105
0.07-0.09   4       0.8   1.3     8       |   85    100%    37% |  79%  21%   0%   90
0.07-0.09   4       1     1       6       |   85    100%    37% |  56%  44%   0%   91
```

(The sweep script lists every combination; these are the rows that carry the argument. "ehull espread ereload" are the enemy's hull factor, spread multiple and reload in seconds; "decisive" counts a sinking *or* a ship breaking off at 25% hull.)

| Constant | Before | Now | Why |
|---|---|---|---|
| `COMBAT.elevationMin/Max` | 0.05 / 0.11 rad | 0.07 / 0.09 | The balls used to come down anywhere from about 110 to 200 m out, so a ship 130 m away was hit by only about a quarter of the balls. The narrower band lifts the hit rate from 26% to 39% and shortens a mirror duel from 134 s to 99 s. The effect on fairness is small. (An earlier version of this note claimed the narrower band made the aim zone a "35 m band"; that was wrong: the zone shows where a ball can *hit*, which is a long stretch from the hull to about 170 m because low shots hit close in. The elevation range only changes how the hit chance thins out toward the far edge.) |
| `ENEMY_TUNING.hullFactor` | 0.7 | 0.8 | Together with reload and spread this sets how much the enemy is handicapped. With no handicap the bot wins 63% (an even fight); the old handicap gave 93%; the chosen one 86%, leaving room for a human who plays worse than the bot. |
| `COMBAT.enemyReload` | 10 s | 8 s | Same. |
| `COMBAT.enemySpread` | 1.6× | 1.3× | Same. |
| `COMBAT.damagePerLb` | 2.5 | 2.5 (unchanged) | Doubling the hit points taken per ball (4 vs 2.5) only shortens a fight from 99 s to 85 s at the same fairness; duels already end in under two minutes. |
| `COMBAT.maxPerVolley` | 24 | 24 (unchanged) | Bigger broadsides hit harder instead (see `fireBroadside`), so the cap does not cost firepower. |
| `pickEnemySpec` | armed ship whose hull is closest to 80% of yours | armed, no more than 1.2× your speed, strength within 0.45–1.7× of yours (strength = √(hull × broadside damage)), closest to 0.85× | Speed decided fights. With the old rule (commit 8b4b108) a 7-knot Barque won 12% against its Yacht (9 knots) and a Galleon 7% against its Pinnace (11 knots), while Corvette, Frigate and Pinnace won about 100%. |
| `CONFIG.giveUpRange/Seconds` | 1500 m / 30 s | 1000 m / 20 s | An enemy is now at most 1.2× faster, so the gap grows slowly; 1.5 km took minutes to open. |

The simulator itself needed fixing before it measured anything: the wind and the AI's tie-breaks favoured whichever side started in the west (a mirror match was 100/0). Each pairing is now fought half and half from each side, with a small random sideways offset, heading and wind phase per seed. A first version of this report also counted a ship that broke off at 25% hull as "undecided", which made fights look far slower than they are; breaking off now counts as a loss, as it is in the game.

## The damage model (slice 5a.3e)

Hit zones, rigging, leaks and fire (`gameplay/damage.ts`) went in after the tuning above, and the duel simulator uses them, so the report below was re-measured with them. The picture barely moved: rigging hits cost the target hull points at 30% of a full hit and slow it, so duels are a little longer and the odds shift a little toward the side that keeps its sails. Only one pairing moved visibly (Lugger against Yacht, rank 1: the bot's win rate fell from 82% to 62% and 13% of duels run out the clock, because a fast ship with torn sails cannot get its broadside to bear). Mirror matches stayed at 45–55%, the escape table is unchanged, and no constant was retuned. The damage constants (`DAMAGE`) were chosen for feel, not fitted to these tables; a human playtest should confirm them.

## What the bot does not model

A human (aim zones, hit feedback, reading the wind by hand); more than one enemy at a time (the game sends up to three, so ranks 1 and 2 are harder in play than in the table); boarding; repair in harbour; the 25 s respawn; sail changes; repairing rigging and pumping (the bot never docks); anything but open water. Both sides use the enemy AI's fire rule (within ±20° of abeam and 180 m). The bot is better at positioning than a beginner and worse than a good player. The 20 Hz step was checked against 60 Hz (40 seeds, four pairings): win rates agree within 2–5 points and durations to the second.

## How to read the tables

- **win** is the bot player winning: the enemy sinks or breaks off (hull below 25%). **loss** is the reverse. **got away** / **enemy got away**: one side lost from sight for 20 s beyond 1 km. **draw**: ran out the 420 s. **hit** is the share of the player's balls that hit.
- Ranks 1 and 2 only appear after 2 and 4 kills. A short pool repeats a type (Barque and Caravel meet the same ship at every rank; Battleship alternates Battleship and Frigate; Galleon meets Galleon and Caravel), so those rows carry no extra information.
- **Tartane has no guns** and cannot win: it must run (its hunter is no faster than it is) or dock, where it is safe. Its enemy is always the weakest armed ship that cannot outrun it.
- Slow, heavy ships still have the harder job (turn rate and speed decide who gets the broadside); the speed rule only stops them meeting hunters they cannot match.

## Tools

- `npm run balance` this report. `BALANCE_SEEDS=40 npm run balance` for steadier numbers; `npm run balance -- --mirror` only the mirror check; `--no-escape` skips the escape table (the slowest part).
- `npm run balance:sweep` the parameter sweep above (mutates `COMBAT`/`ENEMY_TUNING` in memory only).
- `npm run balance:chase -- brig schooner` can the first ship shake the second? (`scripts/chase.ts`)
- `npx vite-node scripts/accuracy.ts brig schooner` hit rates and shots per duel for one pairing.


**Ballistics note.** Cannonballs now fly with quadratic air drag (0.00035 per metre) and a muzzle speed of 92 m/s (it was 90 with no drag), chosen so the landing distance and every win-rate window stayed where they were; the duel flies balls in still air with no sea skips and no ship collisions, so what is measured here is the sailing, gun and damage model only.

Report: 60 seeds per pairing.

## Player against each of its three enemies

| Player | Enemy | rank | win | loss | got away | enemy got away | draw | median s | hull left | hit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tartane (7) | Barque (7) | 0 | 0% | 100% | 0% | 0% | 0% | 193 | 13% | 0% |
| Tartane (7) | Barque (7) | 1 | 0% | 100% | 0% | 0% | 0% | 193 | 13% | 0% |
| Tartane (7) | Barque (7) | 2 | 0% | 100% | 0% | 0% | 0% | 193 | 13% | 0% |
| Yacht (9) | Yacht (9) | 0 | 68% | 32% | 0% | 0% | 0% | 168 | 62% | 16% |
| Yacht (9) | Barque (7) | 1 | 100% | 0% | 0% | 0% | 0% | 138 | 89% | 26% |
| Yacht (9) | Sloop (10) | 2 | 60% | 37% | 0% | 0% | 3% | 166 | 55% | 23% |
| Lugger (16) | Lugger (16) | 0 | 67% | 33% | 0% | 0% | 0% | 125 | 61% | 17% |
| Lugger (16) | Yacht (9) | 1 | 52% | 23% | 0% | 0% | 25% | 211 | 63% | 12% |
| Lugger (16) | Barque (7) | 2 | 100% | 0% | 0% | 0% | 0% | 120 | 88% | 35% |
| Sloop (10) | Barque (7) | 0 | 100% | 0% | 0% | 0% | 0% | 125 | 91% | 32% |
| Sloop (10) | Yacht (9) | 1 | 85% | 15% | 0% | 0% | 0% | 155 | 73% | 21% |
| Sloop (10) | Sloop (10) | 2 | 77% | 23% | 0% | 0% | 0% | 165 | 61% | 28% |
| Schooner (12) | Xebec (10) | 0 | 80% | 20% | 0% | 0% | 0% | 126 | 64% | 34% |
| Schooner (12) | Schooner (12) | 1 | 63% | 37% | 0% | 0% | 0% | 123 | 58% | 29% |
| Schooner (12) | Sloop (10) | 2 | 92% | 8% | 0% | 0% | 0% | 127 | 75% | 25% |
| Barque (7) | Barque (7) | 0 | 72% | 28% | 0% | 0% | 0% | 145 | 57% | 34% |
| Barque (7) | Barque (7) | 1 | 72% | 28% | 0% | 0% | 0% | 145 | 57% | 34% |
| Barque (7) | Barque (7) | 2 | 72% | 28% | 0% | 0% | 0% | 145 | 57% | 34% |
| Xebec (10) | Xebec (10) | 0 | 60% | 40% | 0% | 0% | 0% | 118 | 57% | 33% |
| Xebec (10) | Sloop (10) | 1 | 90% | 10% | 0% | 0% | 0% | 141 | 66% | 25% |
| Xebec (10) | Schooner (12) | 2 | 62% | 38% | 0% | 0% | 0% | 129 | 53% | 28% |
| Galeoth (13) | Yacht (9) | 0 | 65% | 35% | 0% | 0% | 0% | 140 | 57% | 19% |
| Galeoth (13) | Barque (7) | 1 | 100% | 0% | 0% | 0% | 0% | 111 | 86% | 31% |
| Galeoth (13) | Galeoth (13) | 2 | 73% | 27% | 0% | 0% | 0% | 109 | 64% | 35% |
| Caravel (8) | Caravel (8) | 0 | 75% | 25% | 0% | 0% | 0% | 158 | 63% | 35% |
| Caravel (8) | Caravel (8) | 1 | 75% | 25% | 0% | 0% | 0% | 158 | 63% | 35% |
| Caravel (8) | Caravel (8) | 2 | 75% | 25% | 0% | 0% | 0% | 158 | 63% | 35% |
| Fleut (10.5) | Schooner (12) | 0 | 55% | 45% | 0% | 0% | 0% | 208 | 43% | 26% |
| Fleut (10.5) | Xebec (10) | 1 | 43% | 57% | 0% | 0% | 0% | 174 | 39% | 29% |
| Fleut (10.5) | Fleut (10.5) | 2 | 87% | 13% | 0% | 0% | 0% | 147 | 64% | 48% |
| Brig (14) | Schooner (12) | 0 | 87% | 13% | 0% | 0% | 0% | 125 | 70% | 28% |
| Brig (14) | Fleut (10.5) | 1 | 97% | 3% | 0% | 0% | 0% | 123 | 79% | 43% |
| Brig (14) | Xebec (10) | 2 | 93% | 7% | 0% | 0% | 0% | 117 | 74% | 37% |
| Pinnace (11) | Caravel (8) | 0 | 95% | 5% | 0% | 0% | 0% | 145 | 77% | 35% |
| Pinnace (11) | Fleut (10.5) | 1 | 100% | 0% | 0% | 0% | 0% | 128 | 85% | 35% |
| Pinnace (11) | Pinnace (11) | 2 | 83% | 17% | 0% | 0% | 0% | 175 | 63% | 40% |
| Corvette (16) | Pinnace (11) | 0 | 75% | 18% | 0% | 0% | 7% | 215 | 63% | 21% |
| Corvette (16) | Galleon (7) | 1 | 100% | 0% | 0% | 0% | 0% | 99 | 82% | 53% |
| Corvette (16) | Corvette (16) | 2 | 80% | 20% | 0% | 0% | 0% | 80 | 55% | 48% |
| Galleon (7) | Galleon (7) | 0 | 67% | 33% | 0% | 0% | 0% | 173 | 57% | 55% |
| Galleon (7) | Caravel (8) | 1 | 40% | 60% | 0% | 0% | 0% | 231 | 33% | 17% |
| Galleon (7) | Galleon (7) | 2 | 67% | 33% | 0% | 0% | 0% | 173 | 57% | 55% |
| Frigate (14.7) | Corvette (16) | 0 | 85% | 15% | 0% | 0% | 0% | 78 | 59% | 46% |
| Frigate (14.7) | Galleon (7) | 1 | 100% | 0% | 0% | 0% | 0% | 99 | 81% | 52% |
| Frigate (14.7) | Frigate (14.7) | 2 | 82% | 18% | 0% | 0% | 0% | 80 | 55% | 59% |
| Battleship (12.6) | Battleship (12.6) | 0 | 95% | 5% | 0% | 0% | 0% | 90 | 52% | 69% |
| Battleship (12.6) | Frigate (14.7) | 1 | 82% | 18% | 0% | 0% | 0% | 88 | 55% | 44% |
| Battleship (12.6) | Battleship (12.6) | 2 | 95% | 5% | 0% | 0% | 0% | 90 | 52% | 69% |

## Mirror check: the same ship on both sides, both as the player (should be near 50% each way)

| Ship | a wins | b wins | other |
| --- | --- | --- | --- |
| Tartane | 0% | 0% | 100% |
| Yacht | 53% | 47% | 0% |
| Lugger | 55% | 45% | 0% |
| Sloop | 55% | 45% | 0% |
| Schooner | 47% | 53% | 0% |
| Barque | 53% | 47% | 0% |
| Xebec | 52% | 48% | 0% |
| Galeoth | 55% | 45% | 0% |
| Caravel | 55% | 45% | 0% |
| Fleut | 52% | 48% | 0% |
| Brig | 47% | 53% | 0% |
| Pinnace | 45% | 55% | 0% |
| Corvette | 50% | 50% | 0% |
| Galleon | 50% | 50% | 0% |
| Frigate | 57% | 43% | 0% |
| Battleship | 48% | 52% | 0% |

## Escape: the player runs from the rank-0 enemy (it hunts, the runner never fires; 600 s)

A runner that is faster should get away; at equal or lower speed nobody wins: the chase just goes on (the runner is rarely caught, because a hunter needs a broadside to bear).

| Runner | Hunter | got away | caught | chase goes on |
| --- | --- | --- | --- | --- |
| Tartane (7) | Barque (7) | 0% | 0% | 100% |
| Yacht (9) | Yacht (9) | 0% | 0% | 100% |
| Lugger (16) | Lugger (16) | 0% | 0% | 100% |
| Sloop (10) | Barque (7) | 100% | 0% | 0% |
| Schooner (12) | Xebec (10) | 100% | 0% | 0% |
| Barque (7) | Barque (7) | 0% | 0% | 100% |
| Xebec (10) | Xebec (10) | 0% | 0% | 100% |
| Galeoth (13) | Yacht (9) | 100% | 0% | 0% |
| Caravel (8) | Caravel (8) | 0% | 0% | 100% |
| Fleut (10.5) | Schooner (12) | 0% | 0% | 100% |
| Brig (14) | Schooner (12) | 100% | 0% | 0% |
| Pinnace (11) | Caravel (8) | 100% | 0% | 0% |
| Corvette (16) | Pinnace (11) | 100% | 0% | 0% |
| Galleon (7) | Galleon (7) | 0% | 0% | 100% |
| Frigate (14.7) | Corvette (16) | 0% | 0% | 100% |
| Battleship (12.6) | Battleship (12.6) | 0% | 0% | 100% |
