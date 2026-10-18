# Sea (waves, weather, water shading)

## Model (`world/sea.ts`)
- Seven **Gerstner waves** (`WAVES`: 90 m swell down to 5.5 m chop). Points travel in circles, so crests sharpen and troughs flatten; the crest pull is capped (`chop`) so a big sea never folds over itself.
- `waveHeight(x, z, time, windFrom, ampScale, minLength)` is the surface as the eye sees it (rest position found by 5 fixed-point steps); `waveSlope` gives its gradient. The vertex shader is generated from the same data (`render/waves.ts` `waveGlsl`), and `tests/waves.test.ts` evaluates the emitted GLSL in JS to prove both agree.
- **Sea state** `seaStateAt(time, windSpeed)` ∈ 0 (glassy) … 1 (storm): the wind builds it, plus a rare slow "storm cell". `seaAmp(state)` maps it to the amplitude scale (0.4 … 2.6). It is carried in `GameView.seaState`; `game.dev.setSea(x)` forces it (`null` = weather).
- `windAt` is untouched, so the balance tables and duel simulator are unchanged.

## Performance baseline (before the rework)
Measured with `?perf` on the sailing view (small embedded pane): **539,370 triangles, 62 draw calls**; about 462k of those triangles are the two flat sea grids (900 m × 360² near + 7 km × 320² far). Frame rate in the embedded pane is not a reliable absolute number (82–165 fps); compare like with like.
