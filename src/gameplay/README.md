# gameplay

Game rules and state. Depends on `core`, `ships`, `world`; never on `render` or `ui`.

Public API: `createGame(spec)` → `{ update(dt, controls), view() }`; `view()` returns a `GameView` (types in `core/views.ts`). `sailing.ts` holds the player-ship model and its tuning constants (`SAILING`); it is internal, tests import it directly.

Fixed-step only (see `core/loop.ts`); no wall-clock time. Combat, trade and quests will live here (phase 5).
