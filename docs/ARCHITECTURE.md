# Architecture

## Modules (`src/`)
| Module | Responsibility | May import |
|---|---|---|
| `core` | fixed-step loop, input, math, config, shared view types | — |
| `ships` | ship specs (data), procedural mesh factory, sail trim | `core` |
| `world` | wind, polar diagram, archipelago terrain (height function), ports | `core` |
| `render` | three.js scene, camera, ocean, sky | `core`, `ships`, `world` |
| `gameplay` | combat, trade, quests, game state | `core`, `ships`, `world` |
| `audio` | procedural sound (Web Audio), spatial mix | `core` |
| `ui` | DOM HUD, map, port panel, menus | `core`, `gameplay`, `world` (static map data only) |
| `app` | composition layer: one `Mode` per screen (gallery, sailing) wiring modules together | all |
| `main.ts` | entry: owns the active `Mode`, drives the loop | `app`, `core` |

Rules: one-way dependencies; import via each module's `index.ts` (the `app` layer is the exception: it is a set of screens, not a feature module, so `main.ts` imports `app/*Mode.ts` files directly and eslint does not restrict `src/app`). `ui` currently imports `core` types and static `world` data (map, harbour panel); its `gameplay` allowance is unused for now; `render` reads state only; data tables live apart from behaviour.

## Data flow
input → gameplay state (fixed update) → render reads the latest state each frame (no interpolation yet; the loop passes `alpha` but modes ignore it, so motion can judder above 60 Hz).

## How render reads state without importing gameplay
`core/views.ts` owns the read-only snapshot types `GameView`, `ShipView`, `EnemyView`, `BallView`, `GameEvent`, `PortView`, `WindView` and the plain `Controls` input. `gameplay` produces a `GameView`; the active `app` mode passes it to `render` and `ui` each frame. So `render` and `ui` depend only on `core` types, never on `gameplay` internals. Static world data (terrain height, islands, ports) is not state: `render` and `ui` read it straight from `world`, and `gameplay` uses the same `terrainHeight` for collisions, so what you see is what you hit.

## Status
Phases 1–4 and slices 5a, 5a.1 done: `core` (loop, math, input, views), `ships` (specs, factory, `setSailTrim`), `world` (wind, polar, archipelago, ports), `gameplay` (sailing model, grounding, docking, discovery, cannons, enemy AI), `render` (gallery stage, sailing view with enemy ships, cannonballs and particle effects, ocean/sky shaders, island scenery), `ui` (gallery, HUD, map, port panel), `audio` (synthesised effects and ambience), `app` (gallery and sailing modes). No boarding, trade, shipyard or quests yet. See `ROADMAP.md`.

Conventions worth knowing: the sea surface is one definition (`render/waves.ts`) used by both the vertex shader and the CPU (ships ride the waves); the land is one height function (`world/islands.ts`) used by the terrain meshes, the sea-shader depth texture, the map, and ship collisions; game time is fixed-step, wind is a pure function of time (`world/wind.ts`).
