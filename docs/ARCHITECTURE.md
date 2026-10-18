# Architecture

## Modules (`src/`)
| Module | Responsibility | May import |
|---|---|---|
| `core` | fixed-step loop, input, event bus, config | — |
| `ships` | ship specs (data), procedural factory, GLB ships (`assets`, `glbShip`), LOD selection (`lod`), walkable deck (`deck`), sail trim | `core` |
| `world` | wind, islands, ports | `core` |
| `render` | three.js scene, camera, ocean, sky, other ships (`fleet`), animated crew (`crew`) | `core`, `ships`, `world` |
| `gameplay` | combat, trade, quests, game state, deck crew (`crew`), NPC patrols (`npcShips`) | `core`, `ships`, `world` |
| `ui` | DOM HUD, menus | `core`, `gameplay` |
| `main.ts` | composition root | all |

Rules: one-way dependencies; import via each module's `index.ts`; `render` reads state only; data tables live apart from behaviour.

## Data flow
input → gameplay state (fixed update) → render reads state (per frame, interpolated).

## How render reads state without importing gameplay
`core` owns read-only view types (e.g. `GameView`, `ShipView`: position, heading, sail trim). `gameplay` produces objects satisfying them; `main.ts` passes the view to `render` each frame. So `render` depends only on `core` types, never on `gameplay`. Define these types in phase 3.

## Status
Phase 2 done: `core` (loop), `ships` (specs + procedural factory), `render` (gallery stage), `ui` (gallery panel), composed in `main.ts`. `world` and `gameplay` do not exist yet. `render` currently receives a plain `THREE.Object3D` from `main.ts`, so it does not import `ships`. See `ROADMAP.md`.

## Blender models, LOD and crew (phase 2c)
- `main.ts` preloads GLBs (`loadShipAssets`, `loadCrewAssets`) before the first mode; failures only log and fall back to procedural ships / an empty deck.
- `createShip(spec)` returns a GLB-backed `Ship` when one is loaded. `Ship.setLod?` exists only on those; **the player's ship is never switched**.
- `GameView` now carries `others: OtherShipView[]` (NPC patrols from `gameplay/npcShips`) and `crew: CrewView[]` (from `gameplay/crew`, ship-local, deterministic on the fixed step). `render` reads them like the rest of the view.
- `render/fleet.ts` places other ships (shared `render/ride.ts` wave riding) and switches their LOD by camera distance with hysteresis (`ships/lod.ts`). `render/crew.ts` clones the crew GLBs, tints materials, runs the `AnimationMixer` with a local `THREE.Clock` (so `Mode.render` is unchanged) and parents the sailors to the player ship.
- Walkable deck and obstacles come from `<id>.meta.json` through `ships/deck.ts` (`Deck`), used by gameplay crew AI.
- Debug: `?perf` (window.__perf) and `?lod=0|1|2`.

