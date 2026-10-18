# core

Game-agnostic foundations; imports nothing from other modules.

- `loop.ts` fixed-step loop (`startLoop`), `config.ts` constants (`CONFIG.sinkSeconds` is shared by gameplay and render)
- `math.ts` `clamp`, `lerp`, `smoothstep`, `wrapAngle`, `angleDiff`
- `input.ts` keyboard tracker (`isDown`, one-shot `pressed`, `endFrame`)
- `rng.ts` seeded random generator (`createRng`) for deterministic gameplay
- `views.ts` read-only snapshots and plain input shared across modules: `GameView`, `ShipView` (incl. `aim`, `inRange`, `reload`), `EnemyView` (incl. `nation`, `fleeing`), both with the `Condition` fields `rigging`, `flooding`, `fire` (0..1), `HitZone`, `BallView`, `GameEvent` (`hit` carries `amount` and `zone`; types fire, splash, hit, sunk, escaped), `AimZoneView`, `PortView`, `WindView`, `Controls`. Also documents the world/heading/wind angle conventions; read it before touching anything angular.
