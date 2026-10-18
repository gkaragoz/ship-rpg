# render

three.js scenes. Depends on `core` types and static `world` data. It may import `ships` per the architecture table but currently does not: the app hands it plain `THREE.Object3D` ship models. Never reads `gameplay`.

- `galleryView.ts` orbit stage for browsing ships, frames the model in the area not covered by panels
- `sailingView.ts` open-sea scene: ocean, sky, island scenery, chase camera; the player's ship and enemy actors (`addActor`/`removeActor`) ride the waves and sink; cannonballs are one instanced mesh
- `aimArcs.ts` gun hit zones on the sea (from `GameView.ship.aim` incl. its hit-chance `profile`, shaded by it, and `inRange`), draped on the long swell
- `damageNumbers.ts` floating damage numbers (`mergeHits` merges a volley into one number per target)
- `effects.ts` pooled sprite particles (ring of 320) for muzzle smoke, splashes, hits and sinking, spawned from `GameView.events`; `hit` events vary by `zone` (rigging: torn cloth scraps, waterline: thud + splinters + low spray, hull/none: flash + wood). `burn(x, y, z, intensity, dt)` is called every frame per burning ship and emits additive flames + dark smoke at a dt-independent rate (`burnRate`, `emitAccumulator`, capped at `MAX_BURN_EMIT` per call; pure helpers, unit-tested)
- `waves.ts` the sea surface definition: `waveHeight` on the CPU and `waveGlsl` for the vertex shader come from the same table, keep them together; short waves fade with distance (`lod`)
- `ocean.ts` fine near mesh + coarse far mesh to the horizon, shallows and shore foam from a baked depth texture (`FOG_NEAR`/`FOG_FAR`, `SUN_DIR`, `HORIZON_COLOR`), `sky.ts` gradient dome
- `scenery.ts` per-island terrain mesh, cone trees, port towns (houses, pier, flag, name sprite)

Dispose every renderer, geometry, texture and control you create (see each `dispose()`).
