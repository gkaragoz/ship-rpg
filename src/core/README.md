# core

Game-agnostic foundations; imports nothing from other modules.

- `loop.ts` fixed-step loop (`startLoop`), `config.ts` constants
- `math.ts` `clamp`, `lerp`, `smoothstep`, `wrapAngle`, `angleDiff`
- `input.ts` keyboard tracker (`isDown`, one-shot `pressed`, `endFrame`)
- `views.ts` read-only snapshots and plain input shared across modules: `GameView`, `ShipView`, `WindView`, `Controls`. Also documents the world/heading/wind angle conventions; read it before touching anything angular.
