# render

three.js scenes. Depends on `core` types, `ships`-free (it receives plain `THREE.Object3D` models) and reads static data from `world`; never reads `gameplay`.

- `galleryView.ts` orbit stage for browsing ships, frames the model in the area not covered by panels
- `sailingView.ts` open-sea scene: ocean, sky, island scenery, chase camera; the player's ship and enemy actors (`addActor`/`removeActor`) ride the waves and sink; cannonballs are one instanced mesh
- `effects.ts` pooled sprite particles for muzzle smoke, splashes, hits and sinking, spawned from `GameView.events`
- `waves.ts` the sea surface definition: `waveHeight` on the CPU and `waveGlsl` for the vertex shader come from the same table, keep them together; short waves fade with distance (`lod`)
- `ocean.ts` fine near mesh + coarse far mesh to the horizon, shallows and shore foam from a baked depth texture (`FOG_NEAR`/`FOG_FAR`, `SUN_DIR`, `HORIZON_COLOR`), `sky.ts` gradient dome
- `scenery.ts` per-island terrain mesh, cone trees, port towns (houses, pier, flag, name sprite)

Dispose every renderer, geometry, texture and control you create (see each `dispose()`).
