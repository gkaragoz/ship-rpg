# render

three.js scenes. Depends on `core` types only (it receives plain `THREE.Object3D` models and `GameView` snapshots); never reads `gameplay` or `ships` internals.

- `galleryView.ts` orbit stage for browsing ships, frames the model in the area not covered by panels
- `sailingView.ts` open-sea scene: ocean, sky, chase camera, ship rides the waves
- `waves.ts` the sea surface definition: `waveHeight` on the CPU and `waveGlsl` for the vertex shader come from the same table, keep them together
- `ocean.ts` wave-displaced, flat-shaded sea (also exports `SUN_DIR`, `HORIZON_COLOR`), `sky.ts` gradient dome

Dispose every renderer, geometry and control you create (see each `dispose()`).
