# Blender pipeline (Llama + `blender-mcp`)

How the ships (all 16 generated from `ShipSpec` data) and the crew are produced, so a changed or new ship can be regenerated the same way.

## Pieces
| Piece | Where |
|---|---|
| Model | `llama-server` (Gemma 4 26B-A4B, 16k context, port 8080) with its web UI |
| Bridge | `blender-mcp --transport http --port 9191` ↔ Blender add-on (socket 9876); `C:/blender_mcp`, tools such as `execute_blender_code` |
| Scripts | `tools/blender/` in this repo: `shipkit.py` (helpers), `shipbuilder.py` + `make_ships.py` (generic flat-colour ships from `ships.json`), the **PBR pipeline** (`pbr*.py`, `hullmath.py`, see below) for the flagships, `make_tartane.py` (legacy hand-tuned tartane, reference only), `make_crew.py` |
| Outputs | `public/models/ships/*`, `public/models/crew/*` (the scripts find the repo from `__file__`) |
| Gate | `tests/assets.test.ts` (GLB contract, see `SHIP_ASSETS.md`) + `npm run check` |

## How to run a generator (what the LLM is told to do)
The model's context is only 16k tokens, so **never ask it to write the script**: the scripts live on disk and the model runs a
fixed wrapper with one `execute_blender_code` call (the user approves each call; check the code first):

```python
p = "<repo or worktree>/tools/blender/make_ships.py"
g = {"__name__": "__main__", "__file__": p}
exec(compile(open(p, encoding="utf-8").read(), p, "exec"), g)
result = g["RESULT"]
```

Prompt shape that works: English, one task, the exact code block, "do NOT write, plan or edit code", "reply with the result dict
only, on error report the text and stop". Open a **new chat per task**; long prompts and any reasoning about index orders make the
model loop (a 4.5k-token deliberation on vertex indices was the failure mode). Check results from disk (`ls`, parse the GLB), not
from the model's summary.

Both generators end with a `RESULT` dict, so the same wrapper works for `make_ships.py` and `make_crew.py` (only the path changes).
Requirements: Blender 5.x (tested on 5.2.2 LTS) with its bundled glTF exporter and numpy, `blender-mcp` add-on enabled ("MCP Bridge Server" running), no extra pip packages.
Headless smoke test (about 5 s for the flat-colour ships, 5–10 s per PBR ship) and success check: `blender -b --factory-startup --python tools/blender/make_ships.py` must finish without a traceback and update
`public/models/ships/<id>.{glb,meta.json}`; then `npm run check` (the asset contract tests) must pass.

## Rules every generator must follow (learned the hard way)
1. **Do not touch the user's open scene.** Build inside `shipkit.Scratch()`: it snapshots datablocks, selection, active object and
   frame range, and on exit removes everything it created. Never `read_factory_settings`, never delete existing objects.
2. **Export only your own objects** with `use_selection=True`. Without it the GLB contained the user's other ships.
3. Names: `[A-Za-z0-9_-]` only; unique so Blender never appends `.001`.
4. Validate before exporting (`validate_ship`: names, per-LOD triangle budgets, ≤ 2 materials, sail pivots) and raise one clear `ValueError`.
5. Write `meta.json` next to the GLB; the game reads deck/obstacles/pivot from it, not from magic numbers.
6. Test headless first: `blender -b --factory-startup --python tools/blender/make_ships.py`, then let the LLM run it in the GUI.
7. Re-run is idempotent (outputs overwritten, scratch objects removed). Dependencies: only `bpy`, `bmesh`, `numpy`, `mathutils`.

## Generic ships (`make_ships.py`)
`tools/blender/ships.json` is exported from `src/ships/specs.ts` (`npm run export:specs`; `tests/shipsJson.test.ts` fails when it is stale).
`shipbuilder.py` ports `hullShape`, `hull`, `castles`, `rig` (square, gaff, lug, lateen, spanker, shrouds, tops, pennant, bowsprit, jibs) and `details`
(gun ports with cannon muzzles, oars, stern windows, lanterns) and builds LOD0/1/2 per ship; `shipdetails.py` adds the LOD0-only extras (rudder, bow anchors, ratlines, hatch coaming, deck seams, hull plank lines, rivets, barrels, stern lantern post).
It writes `<id>.glb`, `<id>.meta.json` (deck profile, one obstacle per mast and castle plus the hatch, `specHash`) and the atlas.
Colours come from `hullColor`/`trimColor` (the lower hull is the linear-space half of the hull colour, as in `materials.ts`).
Run any subset by passing `IDS` in the wrapper globals:

```python
p = "<repo>/tools/blender/make_ships.py"
g = {"__name__": "__main__", "__file__": p, "IDS": ["yacht", "lugger", "sloop", "schooner", "barque"]}   # 5 ships per call is quick
exec(compile(open(p, encoding="utf-8").read(), p, "exec"), g)
result = g["RESULT"]
```
Changing a spec: edit `specs.ts`, `npm run export:specs`, re-run the ship through Llama, `npm run check`. Changing the look of every ship: edit `shipbuilder.py` and re-run all ids.

## Adding or regenerating a ship
1. Edit (or add) the spec in `src/ships/specs.ts`; for a new ship also add its id to `GLB_SHIP_IDS` in `src/ships/assets.ts` and a patrol/gallery use as needed.
2. `npm run export:specs` (rewrites `tools/blender/ships.json`; `tests/shipsJson.test.ts` fails if you forget).
3. Smoke-test headless: `blender -b --factory-startup --python tools/blender/make_ships.py` (all ships, ~5 s; or set `IDS` as in the wrapper above). A budget or naming problem raises one `ValueError` per ship and **writes nothing for that ship** (the atlas PNG is saved only after validation); ships built earlier in the same call are already written.
4. Let Llama run the wrapper with `IDS` (5 ships per call keeps each call fast; all 16 ships = 3-4 calls). Check the call's code before approving, then the result dict.
5. `npm run check`: `tests/assets.test.ts` checks every ship (names, budgets, materials, pivots on their mast, `specHash` equal to the current spec, deck and obstacle sanity).
6. Look at it in the browser: gallery, then `?perf&lod=0|1|2` in the sailing mode.
`make_tartane.py` is the legacy hand-tuned tartane (superseded by the generic builder, which now has all its details); new ships should use the generic builder.
A rig the builder does not know needs a new builder in `shipbuilder.py` (and `trim-…` pivots following the contract in `SHIP_ASSETS.md`).

## PBR ships (baked textures): tartane, brig, galleon, battleship
`make_ships.py` sends the ids in `PBR_IDS` to `pbrship.build_ship`; the other ids use the flat-colour builder above. Same wrapper, same `IDS`, same `RESULT`; one PBR ship takes about 5–10 s headless
(textures 5–8 s of numpy, vertex AO 1–3 s), so run them two per call (tartane + brig, galleon + battleship) when Llama drives it.

| File | Job |
|---|---|
| `hullmath.py` | hull formulas of `hullShape.ts` as plain numpy (shared by geometry and textures, no `bpy`) |
| `pbrlayout.py` | atlas regions, swatch list, gun ports, wales, plank width: the one source of truth for texture **and** geometry |
| `pbrtex.py`, `pbrhull.py` | numpy texture synthesis (noise, planks, wood and sail tiles; hull/deck/swatch atlas painted in hull coordinates, normals from height fields). No `bpy`: `python -c "import pbrhull"` works for quick previews (`write_png`) |
| `pbrmesh.py` | `PM` mesh builder in **game** coordinates (box, tube, revolve, ellipsoid, grid) with per-vertex colour, tiling UVs in metres and atlas UVs |
| `pbrbody.py`, `pbrcastle.py`, `pbrbow.py`, `pbrdeck.py`, `pbrguns.py`, `pbrrig.py`, `pbrsail.py` | hull/deck/bulwarks/wales, castles + stern gallery + balustrades, stem/figurehead/anchors/rudder, deck furniture/boats/lanterns, ports and cannons, masts/rigging/jibs/flags, sail groups (cloth, yards, boltropes) |
| `pbrao.py` | baked vertex ambient occlusion (BVH ray casts) |
| `pbrmat.py` | images from numpy arrays and glTF-friendly materials (albedo × vertex colour, normal map, ORM with the `glTF Material Output` occlusion group) |
| `pbrship.py` | LOD configs, assembly, validation, export (`export_glb(..., pbr=True)`: WebP textures + meshopt) |

How a PBR ship is made: textures → `Scratch` scope → materials/images → LOD0/1/2 (each: hull, deck, bulwarks, castles, rig, details, sails per pivot, weld, AO, objects) → validate → export
(`use_selection=True`) → `meta.json` (+ `pbr`, `atlasPx`, `tilePx`). Nothing is written when validation fails. All textures are generated from the spec and a seed derived from the id, so a re-run is
byte-identical. To change the look of the flagships edit the generators and re-run the four ids; to add a ship to the PBR set put its id in `PBR_IDS`, give it an atlas size in `pbrship.ATLAS_PX` and
check the budgets in `pbrship.budgets` (the tests recompute the same formula). Tuning guide: planks/wales/copper/ports/weathering are in `pbrhull.hull_region`, canvas and wood grain in `pbrtex`, features per ship size in the part modules.

Previewing without the game: a throwaway page with `GLTFLoader` + `MeshoptDecoder` + `RoomEnvironment` (not in the repo) is the quickest way to look at a GLB from any angle; the real check is the gallery and the sailing view.

Gotchas found while building it:
- The open Blender keeps imported modules between runs, **even from another worktree**: `make_ships.py` therefore drops its own modules from `sys.modules` before importing (an old copy of `shipbuilder` from another checkout once shadowed the new one). Keep that list in step when you add a module.
- Vertex colours in `bmesh` need the float colour **loop** layer named `Col`, linear values; a `Color Attribute` node multiplied into the base colour makes the exporter write `COLOR_0`.
- Mirrored UVs (both hull sides share the atlas region) are fine: three.js derives tangents from UV derivatives.
- Merge coincident vertices (`PM.weld`) before AO and export: tubes and lathes only get smooth shading across ring seams that way, and degenerate pole faces disappear.
- Llama sees `__name__` rendered as bold in its own chat; put the wrapper in a fenced code block.

## Crew
`make_crew.py` builds six body types × 3 LODs, a 12-bone rig, Idle/Walk/Run actions and a palette atlas; details in `CREW.md`.
Animations are authored in world axes and converted per bone (`key_pose`), so bone roll does not matter.

## Troubleshooting
- Llama UI "Server Error: stream resume produced no new bytes": transient; open a new chat and resend.
- Blender is not frontmost / a second Blender opened: the MCP bridge talks to the first instance only (socket 9876); do not launch another one.
- `fps 0` in `?perf` or in demos: the browser tab is in the background (requestAnimationFrame paused).
