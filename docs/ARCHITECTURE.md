# Architecture

## Modules (`src/`)
| Module | Responsibility | May import |
|---|---|---|
| `core` | fixed-step loop, input, event bus, config | — |
| `ships` | ship specs (data), mesh factory, sails, ship physics | `core` |
| `world` | wind, islands, ports | `core` |
| `render` | three.js scene, camera, ocean, sky | `core`, `ships`, `world` |
| `gameplay` | combat, trade, quests, game state | `core`, `ships`, `world` |
| `ui` | DOM HUD, menus | `core`, `gameplay` |
| `main.ts` | composition root | all |

Rules: one-way dependencies; import via each module's `index.ts`; `render` reads state only; data tables live apart from behaviour.

## Data flow
input → gameplay state (fixed update) → render reads state (per frame, interpolated).

## How render reads state without importing gameplay
`core` owns read-only view types (e.g. `GameView`, `ShipView`: position, heading, sail trim). `gameplay` produces objects satisfying them; `main.ts` passes the view to `render` each frame. So `render` depends only on `core` types, never on `gameplay`. Define these types in phase 3.

## Status
Phase 2 done: `core` (loop), `ships` (specs + procedural factory), `render` (gallery stage), `ui` (gallery panel), composed in `main.ts`. `world` and `gameplay` do not exist yet. `render` currently receives a plain `THREE.Object3D` from `main.ts`, so it does not import `ships`. See `ROADMAP.md`.
