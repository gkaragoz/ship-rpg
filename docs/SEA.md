# Sea (waves, weather, water shading)

## Model (`world/sea.ts`)
- Seven **Gerstner waves** (`WAVES`: 90 m swell down to 5.5 m chop). Points travel in circles, so crests sharpen and troughs flatten; the crest pull is capped (`chop`) so a big sea never folds over itself.
- `waveHeight(x, z, time, windFrom, ampScale, minLength, tuning)` (`tuning` is the weather simulator's `SeaTuning` {amp, length, chop, speed}; neutral by default) is the surface as the eye sees it (rest position found by 5 fixed-point steps); `waveSlope` gives its gradient. The vertex shader is generated from the same data (`render/waves.ts` `waveGlsl`), and `tests/waves.test.ts` evaluates the emitted GLSL in JS to prove both agree.
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

Choose with the settings menu (Su kalitesi), `?quality=low|medium|high` (fixed for that load), the `K` key (cycles; both are saved by the settings store, `SETTINGS.md`), or let the game lower it: if a 2 s window averages slower than 40 fps it steps down one preset (never up by itself, never when the quality was chosen explicitly). `?perf` shows `quality` and `frameMs`.

Measured with `?perf` (same pane as the baseline): total triangles **539k → 124k** at medium (181k high, 104k low; the rest is ships and islands); draw calls 62 → 67.

## Look (`render/oceanFragment.ts`, `seaLook.ts`, `sky.ts`)
Stylised but rich: smooth analytic wave normals plus two scrolling detail layers (a tiling noise texture, `seaNoise.ts`), wrapped diffuse, fresnel reflection of the sky, sun glitter (broader and weaker in a rough sea), light glowing through thin crests, a depth tint and shore foam from the baked sea-floor texture. **Whitecaps** form where the surface pinches (the Jacobian of the Gerstner map falls below ~0.6), broken up by noise and thicker as the sea state rises; in a big sea the wind also lays foam streaks along its direction.
`lookFor(seaState, sun)` blends the palette of the hour (day, twilight, night; see `SETTINGS.md`) and then between **fair** (bright, 2.4 km visibility) and **storm** (grey sky and horizon, dark water, dim sun, heavy clouds, visibility down to 1.5 km, fog starting at 90 m); `sailingView` applies it to the fog, the sun, the sky and the sea every frame. The sky has a drifting fbm cloud layer (cover and darkness follow the look). The light is the sun while it is up and the moon after, handing over at the horizon where both fade out. Rain, lightning, cloud and haze come from the weather simulator (`SETTINGS.md`). Try it: `?sea=0` … `?sea=1` in the URL, or `__game.dev.setSea(x)`.

## Ships on the sea (`gameplay/buoyancy.ts`)
- **Motion.** Every simulated hull (player and enemies) has a `Body`: heave, pitch and wave roll are springs that chase the surface sampled under the bow, stern and both sides (`waveHeight`), stepped on the fixed 60 Hz game step. The natural periods grow with length (`periods`: a 12 m tartane about 3.8 s heave, a 64 m battleship 11.6 s), so small ships follow every crest and big ones filter the chop and swing slowly. A moored hull feels 30 % of the swell. `GameView.ship/enemies` carry `heave`, `pitch`, `waveRoll`; `render/ride.ts` only draws them (ambient patrol ships still sample the waves in the renderer).
- **Handling** (`seaEffects`, passed to `stepPlayerShip`; the duel simulator passes none, so `docs/BALANCE.md` is unchanged). Nothing changes below sea state 0.3. Above it: head seas cost up to 22 % of speed (× a size factor: small ships suffer more, large ones less), turning is blunted up to 20 %, and ships with low freeboard take green water over the bow (flooding, more than the pumps clear): the tartane in a full storm, never a battleship.
- **Gunnery.** `gunScatter`: a rolling, pitching hull widens its broadside's sideways spread by up to ~1.5× in a storm; fair weather is unaffected. (The aim-zone display does not include it yet: in a storm it overstates accuracy.)
- **Green water** applies to every ship at sea (enemies too, and a ship lying stopped), costs hull through the existing flooding drain and slows the ship to 55 % at full flooding; the crew's pumps (0.003/s) cannot keep up in a full storm, so a low ship must run before the sea or reach harbour.
- **Wake range.** The map covers 180 m around the camera; zoomed far out, the player's own wake is not painted.
- **HUD and sound.** The panel shows the sea (`Sakin … Fırtına`, red in a storm); the ambience gets louder with the sea state.

## Ships and water (`render/wake.ts`, `wakeStamps.ts`)
- **Wake map** (R foam, G ripple height, B ship shadows redrawn each frame, see `SETTINGS.md`). A 360 m square of sea around the camera is kept as a half-float ping-pong render target (512² on low, 1024² on medium/high): **R foam, G ripple height (m)**. Each frame a pass scrolls it with the camera (snapped to texels), fades the foam (0.45 /s) and the ripples (1.6 /s) and spreads both a little; then ships and splashes are painted in as soft instanced ellipses (one draw call, ≤ 96 stamps). Without half-float render targets (`EXT_color_buffer_float` or `EXT_color_buffer_half_float`) the map is switched off and the rest still works.
- **Stamps** (`shipStamps`, per frame so they are frame-rate independent): a foam ring along the waterline, a **bow wave** (a crest pushed up in front with foam), a **stern wash** (a trough and lots of foam, wider than the hull) and two arms behind, all scaled by speed and sea state; a foundering hull churns a disc of foam; splashes, hits and sinkings paint one-off bursts. Player, enemies and patrol ships all take part.
- **In the shader** the map lifts and lowers the surface (vertex), adds foam through a noise breakup and tilts the normals along the ripples (fragment).
- **Spray.** `effects.spray` throws sprites up and aside at the bow of every ship under way, more with speed and in a rough sea.

## Performance: before and after
Measured with `?perf` in the embedded browser pane (same scene, player under way, 12 patrol ships, crew aboard). The dev machine runs at its 165 fps display cap before and after, so frame time is not a discriminating number here; triangles and draw calls are.

| | triangles | draw calls | sea mesh |
|---|---|---|---|
| Before (two flat grids) | 539,370 | 62 | ~462k triangles |
| low | ~105k | ~108 | ~26k |
| medium (default) | ~125k | ~106 | ~47k |
| high | ~183k | ~103–115 | ~104k |

The wake pass adds two small render-target passes plus one instanced draw per frame (1024² half float on medium/high, 512² on low); the sea pixel shader is heavier than before (detail layers, wake lookups), which is why the quality preset scales the pixel ratio and the automatic step-down exists. Not yet measured on a mid-range GPU.
