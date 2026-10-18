# gameplay

Game rules and state. Depends on `core`, `ships`, `world`; never on `render` or `ui`.

Public API: `createGame(spec)` → `{ update(dt, controls), view() }`; `view()` returns a `GameView` (types in `core/views.ts`): ship (hull, reload), wind, nearest port, docked port, grounded flag, discovered islands and ports, enemies, balls, one-off events, sunk state and kills.

- `sailing.ts` player-ship model and tuning (`SAILING`): wind drive, turning, grounding (`isBlocked` samples the hull against `terrainHeight`), moored state. Internal; tests import it directly.
- `game.ts` orchestration: ports (nearest, docking range `DOCK`), docking, discovery, start position, firing, balls, enemies, sinking and restart; `view()` drains one-off `events` (fire, splash, hit, sunk) for effects.
- `duel.ts` headless duels (`runDuel`, `playerSide`, `enemySide`) on the real sailing, ballistics and damage code with two AI ships: used by `npm run balance` and `tests/balance.test.ts`; see `docs/BALANCE.md` (`flees: true` makes a side run, to measure escape)
- `exploration.ts` fog of war and nearest-port lookup
- `combat.ts` broadside ballistics and hit test (`COMBAT` constants, `fireBroadside`, `stepBall`, `ballHits`) and the aim aid: `aimZone` (where a broadside lands, from the same ballistics) and `targetInZone` (is a ship inside it). `hit` events carry `amount`, the hull points taken off.
- `enemy.ts` enemy ships on the same sailing model driven by `aiStep` (hunt, broadside, flee below 25% hull, wind and shoal avoidance, separation); `lostTrack` (gives up after 20 s beyond 1 km: `CONFIG.giveUpSeconds/giveUpRange`), `desiredEnemies` (1 + one per 2 kills, max 3), `pickEnemySpec(player, rank)` (armed, no more than 1.2× the player's speed, within 0.45–1.7× his strength, best match first), `findSpawn` (deep water, 650 m away, clear of other enemies). Enemies carry a nation id (see `world/nations.ts`); an `escaped` event marks one that got away or gave up.

`game.dev` (damageEnemies, teleportPlayer, setKills) are hooks for tests and the browser console: in dev the running game is on `window.__game` (e.g. `__game.dev.setKills(4)` brings three enemies). The game never calls them. Note `view()` drains events, so calling it from the console can swallow a frame's effects.

Fixed-step only (see `core/loop.ts`); no wall-clock time. Boarding, trade and quests will live here (phase 5b+). Randomness comes from the seeded `core/rng`.
