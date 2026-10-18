# gameplay

Game rules and state. Depends on `core`, `ships`, `world`; never on `render` or `ui`.

Public API: `createGame(spec)` → `{ update(dt, controls), view() }`; `view()` returns a `GameView` (types in `core/views.ts`): ship, wind, nearest port, docked port, grounded flag, discovered islands and ports.

- `sailing.ts` player-ship model and tuning (`SAILING`): wind drive, turning, grounding (`isBlocked` samples the hull against `terrainHeight`), moored state. Internal; tests import it directly.
- `game.ts` ports (nearest, docking range `DOCK`), docking toggle, discovery, start position.

Fixed-step only (see `core/loop.ts`); no wall-clock time. Combat, trade and quests will live here (phase 5).
