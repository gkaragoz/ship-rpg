# render

three.js scenes. Depends on `core` types and static `world` data. It may import `ships` per the architecture table but currently does not: the app hands it plain `THREE.Object3D` ship models. Never reads `gameplay`.

- `galleryView.ts` orbit stage for browsing ships, frames the model in the area not covered by panels; it stands in the same sea and sky as the game (`environment.ts`), far from the islands, and the ship floats on the waves
- `environment.ts` the sea, sky, fog and lights both views share (+ `shadows.ts` the sun's shadow map that follows the ship, `gi.ts` the live sky as image-based light)
- `pipeline.ts` the frame's way to the screen: MSAA target, SSAO/GTAO (+ `ssgiPass.ts` screen-space bounce), bloom, tone mapping, FXAA, render scale; also the frame stats and GPU timer (`gpuTimer.ts`)
- `sailingView.ts` open-sea scene: ocean, sky, island scenery, chase camera; the player's ship and enemy actors (`addActor`/`removeActor`) are drawn with the game's own heave/pitch/roll (`GameView.*.heave/pitch/waveRoll`, see `gameplay/buoyancy.ts`; `ride.ts`) and sink; the day's look (fog, sun, sky, sea colours) follows `GameView.seaState` (`seaLook.ts`); cannonballs are one instanced mesh
- `aimArcs.ts` gun hit zones on the sea (from `GameView.ship.aim` incl. its hit-chance `profile`, shaded by it, and `inRange`), draped on the long swell
- `damageNumbers.ts` floating damage numbers (`mergeHits` merges a volley into one number per target)
- `effects.ts` pooled sprite particles (ring of 520: smoke, flash, splash, spark, dust, flame…); `emit` is its one entry point for the impact effects. `burn(x, y, z, intensity, dt)` is called every frame per burning ship and emits additive flames + dark smoke at a dt-independent rate (`burnRate`, `emitAccumulator`, capped at `MAX_BURN_EMIT` per call; pure helpers, unit-tested)
- `impacts.ts` turns `GameView.events` into particles and wreckage: the muzzle blast and a smoke jet along the barrel, a hit (sparks, splinters, planks flung along the hull's normal; sailcloth scraps for rigging; a water jet at the waterline), a column and ring of spray where a ball lands (dust on land), the crunch of two hulls and the wreckage of a sinking ship.
- `debris.ts` the 3D wreckage: instanced planks, splinters and cloth scraps that tumble, land on the sea, float with the swell and sink (`launch`, `update(dt, surface, wind)`); the Blender prop set (`public/models/props/debris.glb`, nine pieces) is loaded in the background and replaces the shapes built in code (which stay as the fallback); each piece is its own instanced mesh.
- `waves.ts` generates the vertex-shader GLSL from the Gerstner table of `world/sea.ts` (the surface definition lives there; `tests/waves.test.ts` evaluates the GLSL to prove they agree); each wave fades with distance where the mesh is too coarse for it
- `ocean.ts` (+ `oceanMesh.ts` clip-map levels around the camera, `oceanShader.ts` vertex shader and material, `oceanFragment.ts` pixel shader, `seaNoise.ts` tiling detail texture, `seaLook.ts` the day's colours per sea state, `quality.ts` presets and auto step-down), shallows and shore foam from a baked depth texture; `sky.ts` gradient dome with clouds
- `rain.ts` rain streaks around the camera; `lamps.ts` night lamps (glowing windows and lanterns, a few real point lights); `gpuTimer.ts` GPU time of a frame
- `wake.ts` + `wakeStamps.ts` foam and ripple map (half-float render targets) that ships and splashes paint into; the sea shader reads it
- `shipCrews.ts` the sailors of enemies and patrols; `crewPoses.ts` hand-made poses laid over the idle clip; `swimmers.ts` + `swimmerSim.ts` sailors thrown overboard that swim and drown
- `ride.ts` floats patrol ships on the waves (and draws simulated ships with their own motion)
- `portZones.ts` the gold entry rectangle, corner posts and anchor sign of every port near the ship (`world`'s `PORT_ZONE`)
- `scenery.ts` per-island terrain mesh, cone trees, port towns (houses, pier, flag, name sprite)

Dispose every renderer, geometry, texture and control you create (see each `dispose()`).
