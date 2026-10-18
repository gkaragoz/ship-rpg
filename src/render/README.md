# render

three.js scenes. Depends on `core` types and static `world` data. It may import `ships` per the architecture table but currently does not: the app hands it plain `THREE.Object3D` ship models. Never reads `gameplay`.

- `galleryView.ts` orbit stage for browsing ships, frames the model in the area not covered by panels; it stands in the same sea and sky as the game (`environment.ts`), far from the islands, and the ship floats on the waves
- `environment.ts` the sea, sky, fog and lights both views share (+ `shadows.ts` the sun's shadow map that follows the ship, `gi.ts` the live sky as image-based light)
- `pipeline.ts` the frame's way to the screen: MSAA target, SSAO/GTAO (+ `ssgiPass.ts` screen-space bounce), bloom, tone mapping, FXAA, render scale; also the frame stats and GPU timer (`gpuTimer.ts`)
- `sailingView.ts` open-sea scene: ocean, sky, island scenery, chase camera; the player's ship and enemy actors (`addActor`/`removeActor`) are drawn with the game's own heave/pitch/roll (`GameView.*.heave/pitch/waveRoll`, see `gameplay/buoyancy.ts`; `ride.ts`) and sink; the day's look (fog, sun, sky, sea colours) follows `GameView.seaState` (`seaLook.ts`); cannonballs are one instanced mesh
- `aimArcs.ts` gun hit zones on the sea (from `GameView.ship.aim` incl. its hit-chance `profile`, shaded by it, and `inRange`), draped on the long swell
- `damageNumbers.ts` floating damage numbers (`mergeHits` merges a volley into one number per target)
- `effects.ts` pooled sprite particles (ring of 320) for muzzle smoke, splashes, hits and sinking, spawned from `GameView.events`; `hit` events vary by `zone` (rigging: torn cloth scraps, waterline: thud + splinters + low spray, hull/none: flash + wood). `burn(x, y, z, intensity, dt)` is called every frame per burning ship and emits additive flames + dark smoke at a dt-independent rate (`burnRate`, `emitAccumulator`, capped at `MAX_BURN_EMIT` per call; pure helpers, unit-tested)
- `waves.ts` generates the vertex-shader GLSL from the Gerstner table of `world/sea.ts` (the surface definition lives there; `tests/waves.test.ts` evaluates the GLSL to prove they agree); each wave fades with distance where the mesh is too coarse for it
- `ocean.ts` (+ `oceanMesh.ts` clip-map levels around the camera, `oceanShader.ts` vertex shader and material, `oceanFragment.ts` pixel shader, `seaNoise.ts` tiling detail texture, `seaLook.ts` the day's colours per sea state, `quality.ts` presets and auto step-down), shallows and shore foam from a baked depth texture; `sky.ts` gradient dome with clouds
- `wake.ts` + `wakeStamps.ts` foam and ripple map (half-float render targets) that ships and splashes paint into; the sea shader reads it
- `ride.ts` floats patrol ships on the waves (and draws simulated ships with their own motion)
- `scenery.ts` per-island terrain mesh, cone trees, port towns (houses, pier, flag, name sprite)

Dispose every renderer, geometry, texture and control you create (see each `dispose()`).
