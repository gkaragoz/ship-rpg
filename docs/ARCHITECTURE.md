# Architecture

## Modules (`src/`)
| Module | Responsibility | May import |
|---|---|---|
| `core` | fixed-step loop, input, math, config, shared view types | — |
| `ships` | ship specs (data), procedural factory, GLB ships (`assets`, `glbShip`), LOD selection (`lod`), walkable deck (`deck`), sail trim, battle condition | `core` |
| `world` | wind, polar diagram, archipelago terrain (height function), ports, nations (flags) | `core` |
| `render` | three.js scene, camera, ocean, sky, scenery, effects, other ships (`fleet`), animated crew (`crew`) | `core`, `ships`, `world` |
| `gameplay` | combat, trade, quests, game state, deck crew (`crew`), NPC patrols (`npcShips`) | `core`, `ships`, `world` |
| `audio` | procedural sound (Web Audio), spatial mix | `core` |
| `ui` | DOM HUD, map, port panel, menus | `core`, `gameplay`, `world` (static map data only) |
| `app` | composition layer: one `Mode` per screen (gallery, sailing) wiring modules together | all |
| `main.ts` | entry: owns the active `Mode`, drives the loop | `app`, `core` |

Rules: one-way dependencies; import via each module's `index.ts` (the `app` layer is the exception: it is a set of screens, not a feature module, so `main.ts` imports `app/*Mode.ts` files directly and eslint does not restrict `src/app`). `ui` currently imports `core` types and static `world` data (map, harbour panel); its `gameplay` allowance is unused for now; `render` reads state only; data tables live apart from behaviour.

## Data flow
input → gameplay state (fixed update) → render reads the latest state each frame (no interpolation yet; the loop passes `alpha` but modes ignore it, so motion can judder above 60 Hz).

## How render reads state without importing gameplay
`core/views.ts` owns the read-only snapshot types `GameView`, `ShipView`, `EnemyView`, `BallView`, `Condition`, `HitZone`, `GameEvent`, `PortView`, `WindView` and the plain `Controls` input. `gameplay` produces a `GameView`; the active `app` mode passes it to `render` and `ui` each frame. So `render` and `ui` depend only on `core` types, never on `gameplay` internals. Static world data (terrain height, islands, ports) is not state: `render` and `ui` read it straight from `world`, and `gameplay` uses the same `terrainHeight` for collisions, so what you see is what you hit.

## Status
Phases 1–4 and slices 5a, 5a.1, 5a.2, 5a.4 and 5a.3a–d (damage model: hit zones, rigging, leaks, fire) done: `core` (loop, math, input, views), `ships` (specs, factory, `setSailTrim`), `world` (wind, polar, archipelago, ports), `gameplay` (sailing model, grounding, docking, discovery, cannons, enemy AI), `render` (gallery stage, sailing view with enemy ships, cannonballs and particle effects, ocean/sky shaders, island scenery), `ui` (gallery, HUD, map, port panel), `audio` (synthesised effects and ambience), `app` (gallery and sailing modes). No boarding, trade, shipyard or quests yet. See `ROADMAP.md`.

Conventions worth knowing: the sea surface is one definition (`render/waves.ts`) used by both the vertex shader and the CPU (ships ride the waves); the land is one height function (`world/islands.ts`) used by the terrain meshes, the sea-shader depth texture, the map, and ship collisions; game time is fixed-step, wind is a pure function of time (`world/wind.ts`).

## Blender models, LOD and crew (phase 2c)
- `main.ts` preloads GLBs (`loadShipAssets`, `loadCrewAssets`) before the first mode; failures only log and fall back to procedural ships / an empty deck.
- `createShip(spec)` returns a GLB-backed `Ship` when one is loaded. `Ship.setLod?` exists only on those; **the player's ship is never switched**.
- `GameView` now carries `others: OtherShipView[]` (NPC patrols from `gameplay/npcShips`, placed by `placePatrols` on open water around the player's start) and `crew: CrewView[]` (from `gameplay/crew`, ship-local, deterministic on the fixed step). `render` reads them like the rest of the view.
- `render/fleet.ts` places other ships (shared `render/ride.ts` wave riding) and switches their LOD by camera distance with hysteresis (`ships/lod.ts`). `render/crew.ts` clones the crew GLBs, tints materials, runs the `AnimationMixer` with a local `THREE.Clock` (so `Mode.render` is unchanged) and parents the sailors to the player ship.
- Walkable deck and obstacles come from `<id>.meta.json` through `ships/deck.ts` (`Deck`), used by gameplay crew AI.
- Debug: `?perf` (window.__perf) and `?lod=0|1|2`.

