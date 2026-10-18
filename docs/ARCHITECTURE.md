# Architecture

## Modules (`src/`)
| Module | Responsibility | May import |
|---|---|---|
| `core` | fixed-step loop, input, math, config, shared view types | — |
| `ships` | ship specs (data), procedural mesh factory, sail trim | `core` |
| `world` | wind, islands, ports | `core` |
| `render` | three.js scene, camera, ocean, sky | `core`, `ships`, `world` |
| `gameplay` | combat, trade, quests, game state | `core`, `ships`, `world` |
| `ui` | DOM HUD, menus | `core`, `gameplay` |
| `app` | composition layer: one `Mode` per screen (gallery, sailing) wiring modules together | all |
| `main.ts` | entry: owns the active `Mode`, drives the loop | `app`, `core` |

Rules: one-way dependencies; import via each module's `index.ts` (the `app` layer is the exception: it is a set of screens, not a feature module, so `main.ts` imports `app/*Mode.ts` files directly and eslint does not restrict `src/app`). `ui` currently needs only `core`; the `gameplay` allowance is reserved for later; `render` reads state only; data tables live apart from behaviour.

## Data flow
input → gameplay state (fixed update) → render reads the latest state each frame (no interpolation yet; the loop passes `alpha` but modes ignore it, so motion can judder above 60 Hz).

## How render reads state without importing gameplay
`core/views.ts` owns the read-only snapshot types `GameView`, `ShipView`, `WindView` and the plain `Controls` input. `gameplay` produces a `GameView`; the active `app` mode passes it to `render` and `ui` each frame. So `render` and `ui` depend only on `core` types, never on `gameplay` internals.

## Status
Phases 1–3 done: `core` (loop, math, input, views), `ships` (specs, factory, `setSailTrim`), `world` (wind, polar diagram), `gameplay` (sailing model, `createGame`), `render` (gallery stage, sailing view, ocean/sky shaders, shared wave maths), `ui` (gallery panel, HUD), `app` (gallery and sailing modes). No islands, ports, combat or economy yet. See `ROADMAP.md`.

Conventions worth knowing: the sea surface is one definition (`render/waves.ts`) used by both the vertex shader and the CPU (ships ride the waves); game time is fixed-step, wind is a pure function of time (`world/wind.ts`).
