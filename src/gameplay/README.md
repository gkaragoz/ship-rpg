# gameplay

Game rules and state. Depends on `core`, `ships`, `world`; never on `render` or `ui`.

Public API: `createGame(spec)` → `{ update(dt, controls), view() }`; `view()` returns a `GameView` (types in `core/views.ts`): ship (hull, rigging, flooding, fire, reload), wind, nearest port, docked port, grounded flag, discovered islands and ports, enemies, balls, one-off events, sunk state and kills.

- `damage.ts` the damage model (`DAMAGE` constants): `ballHitZone` (in combat) decides waterline/hull/rigging by height; `strike` applies a hit to a ship's `rigging`, `flooding` and `fire` and returns the hull points lost; `stepAffliction` pumps, burns and puts out fires each step; speed and turn factors. Shared by the game and the duel simulator.
- `buoyancy.ts` how a hull rides the sea: heave/pitch/roll springs toward the sampled surface (`stepBody`, periods grow with length), `seaEffects` (head-sea speed loss, turn loss, green water over the bow, none below sea state 0.3) and `gunScatter`; the duel simulator passes no sea
- `weatherState.ts` the weather overrides of the simulator (`Game.setWeather`) and the seeded lightning strikes
- `devHooks.ts` the `game.dev` hooks
- `enemyView.ts` maps an `Enemy` to its `EnemyView`.
- `sailing.ts` player-ship model and tuning (`SAILING`): wind drive, turning, grounding (`isBlocked` samples the hull against `terrainHeight`), moored state, and the ship's rigging, flooding and fire (they slow and blunt it). Internal; tests import it directly.
- `game.ts` orchestration: ports (nearest, docking range `DOCK`), docking, discovery, start position, firing, balls, enemies, sinking and restart; `view()` drains one-off `events` (fire, splash, hit, sunk, escaped, collision) for effects.
- `duel.ts` headless duels (`runDuel`, `playerSide`, `enemySide`) on the real sailing, ballistics and damage code with two AI ships: used by `npm run balance` and `tests/balance.test.ts`; see `docs/BALANCE.md` (`flees: true` makes a side run, to measure escape)
- `exploration.ts` fog of war and nearest-port lookup
- `gunnery.ts` one gun (`fireGun`), a drawn-up broadside (`planBroadside`, rippling with `ripple`), the all-at-once broadside of the duel (`fireBroadside`) and the flight path shown to the player (`arcFor`); `salvo.ts` the queue of guns waiting their turn (recoil, dropped when their ship is lost); `shots.ts` one ball against ships, shore and sea (`resolveBall`).
- `collision.ts` ship-against-ship physics (oriented boxes, mass from displacement, impulse, bow swing, damage from lost energy: `COLLISION`, `collide`, `collideAll`); `crashes.ts` gathers the player, the enemies and the patrols and reports the `collision` events and hull points lost (`stepCrashes`).
- `combat.ts` ballistics with drag and wind (`COMBAT` constants, `stepBall(b, dt, air)`, `windVelocity`, `hitNormal`, `ELEVATION`) and hit test (`ballHits`) and the aim aid: `aimZone` and `hitChanceAt` (where a broadside can hit and with what chance, from the same ballistics and the same height test `ballHits` uses) and `targetInZone` (is a ship inside it). `hit` events carry `amount`, the hull points taken off.
- `enemy.ts` enemy ships on the same sailing model driven by `aiStep` (hunt, broadside, flee below 25% hull, wind and shoal avoidance, separation); `lostTrack` (gives up after 20 s beyond 1 km: `CONFIG.giveUpSeconds/giveUpRange`), `desiredEnemies` (1 + one per 2 kills, max 3), `pickEnemySpec(player, rank)` (armed, no more than 1.2× the player's speed, within 0.45–1.7× his strength, best match first), `findSpawn` (deep water, 650 m away, clear of other enemies). Enemies carry a nation id (see `world/nations.ts`); an `escaped` event marks one that got away or gave up.

`game.dev` (damageEnemies, teleportPlayer, setKills, setRigging, setAffliction, setSea; `Game.setClock` and `Game.setWeather` are the public ways to set the hour and the weather) are hooks for tests and the browser console: in dev the running game is on `window.__game` (e.g. `__game.dev.setKills(4)` brings three enemies). The game never calls them. Note `view()` drains events, so calling it from the console can swallow a frame's effects.

Fixed-step only (see `core/loop.ts`); no wall-clock time. Boarding, trade and quests will live here (phase 5b+). Randomness comes from the seeded `core/rng`.
