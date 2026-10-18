# gameplay

Game rules and state. Depends on `core`, `ships`, `world`; never on `render` or `ui`.

Public API: `createGame(spec)` → `{ update(dt, controls), view() }`; `view()` returns a `GameView` (types in `core/views.ts`): ship (hull, reload), wind, nearest port, docked port, grounded flag, discovered islands and ports, enemies, balls, one-off events, sunk state and kills.

- `sailing.ts` player-ship model and tuning (`SAILING`): wind drive, turning, grounding (`isBlocked` samples the hull against `terrainHeight`), moored state. Internal; tests import it directly.
- `game.ts` orchestration: ports (nearest, docking range `DOCK`), docking, discovery, start position, firing, balls, enemies, sinking and restart; `view()` drains one-off `events` (fire, splash, hit, sunk) for effects.
- `exploration.ts` fog of war and nearest-port lookup
- `combat.ts` broadside ballistics and hit test (`COMBAT` constants, `fireBroadside`, `stepBall`, `ballHits`) and the aim aid: `aimZone` (where a broadside lands, from the same ballistics) and `targetInZone` (is a ship inside it). `hit` events carry `amount`, the hull points taken off.
- `enemy.ts` enemy ships on the same sailing model driven by `aiStep`; `pickEnemySpec`.

Fixed-step only (see `core/loop.ts`); no wall-clock time. Boarding, trade and quests will live here (phase 5b+). Randomness comes from the seeded `core/rng`.
