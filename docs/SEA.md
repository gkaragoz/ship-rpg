# Sea (waves, weather, water shading)

## Model (`world/sea.ts`)
- Seven **Gerstner waves** (`WAVES`: 90 m swell down to 5.5 m chop). Points travel in circles, so crests sharpen and troughs flatten; the crest pull is capped (`chop`) so a big sea never folds over itself.
- `waveHeight(x, z, time, windFrom, ampScale, minLength)` is the surface as the eye sees it (rest position found by 5 fixed-point steps); `waveSlope` gives its gradient. The vertex shader is generated from the same data (`render/waves.ts` `waveGlsl`), and `tests/waves.test.ts` evaluates the emitted GLSL in JS to prove both agree.
- **Sea state** `seaStateAt(time, windSpeed)` ∈ 0 (glassy) … 1 (storm): the wind builds it, plus a rare slow "storm cell". `seaAmp(state)` maps it to the amplitude scale (0.4 … 2.6). It is carried in `GameView.seaState`; `game.dev.setSea(x)` forces it (`null` = weather).
- `windAt` is untouched, so the balance tables and duel simulator are unchanged.

## Performance baseline (before the rework)
Measured with `?perf` on the sailing view (small embedded pane): **539,370 triangles, 62 draw calls**; about 462k of those triangles are the two flat sea grids (900 m × 360² near + 7 km × 320² far). Frame rate in the embedded pane is not a reliable absolute number (82–165 fps); compare like with like.

## Sea mesh (`render/oceanMesh.ts`, `render/quality.ts`)
A **clip-map**: concentric square levels around the camera, each twice as coarse as the one inside it (`grid × grid` cells, hole in the middle of every outer level). Every level snaps to its own cell size so its vertices never slide against the waves; each outer level's hole is two cells smaller than the finer level it surrounds, so the levels overlap (two coarse cells, enough for the snapped centres to differ) instead of leaving a gap, and the finer one wins: drawn later with `LessEqualDepth`, and every coarser level is shifted 4 cm per level lower in the vertex shader. Each wave fades out with distance where the cells are too coarse to hold it (about a third of its wavelength, scaled by the grid), so far water is calm rather than shimmering. The mesh reaches 3 km, past the fog.

| Quality | grid | finest cell | pixel ratio cap | sea triangles |
|---|---|---|---|---|
| low | 48 | 2 m | 1 | ~26k |
| medium (default) | 64 | 1.5 m | 1.5 | ~47k |
| high | 96 | 1 m | 2 | ~100k |

Choose with `?quality=low|medium|high` (fixed), the `K` key (cycles, remembered in `localStorage`), or let the game lower it: if a 2 s window averages slower than 40 fps it steps down one preset (never up by itself, never when the quality was chosen explicitly). `?perf` shows `quality` and `frameMs`.

Measured with `?perf` (same pane as the baseline): total triangles **539k → 124k** at medium (181k high, 104k low; the rest is ships and islands); draw calls 62 → 67.

## Look (`render/oceanFragment.ts`, `seaLook.ts`, `sky.ts`)
Stylised but rich: smooth analytic wave normals plus two scrolling detail layers (a tiling noise texture, `seaNoise.ts`), wrapped diffuse, fresnel reflection of the sky, sun glitter (broader and weaker in a rough sea), light glowing through thin crests, a depth tint and shore foam from the baked sea-floor texture. **Whitecaps** form where the surface pinches (the Jacobian of the Gerstner map falls below ~0.6), broken up by noise and thicker as the sea state rises; in a big sea the wind also lays foam streaks along its direction.
`lookFor(seaState)` blends the day between **fair** (bright, 2.4 km visibility) and **storm** (grey sky and horizon, dark water, dim sun, heavy clouds, visibility down to 1.5 km, fog starting at 90 m); `sailingView` applies it to the fog, the sun, the sky and the sea every frame. The sky has a drifting fbm cloud layer (cover and darkness follow the look). Try it: `?sea=0` … `?sea=1` in the URL, or `__game.dev.setSea(x)`.
