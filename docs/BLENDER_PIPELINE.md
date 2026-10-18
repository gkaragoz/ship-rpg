# Blender pipeline (Llama + `blender-mcp`)

How the ships (tartane by hand, the other 15 generated from `ShipSpec` data) and the crew are produced, so a changed or new ship can be regenerated the same way.

## Pieces
| Piece | Where |
|---|---|
| Model | `llama-server` (Gemma 4 26B-A4B, 16k context, port 8080) with its web UI |
| Bridge | `blender-mcp --transport http --port 9191` ↔ Blender add-on (socket 9876); `C:/blender_mcp`, tools such as `execute_blender_code` |
| Scripts | `tools/blender/` in this repo: `shipkit.py` (helpers), `shipbuilder.py` + `make_ships.py` (generic ships from `ships.json`), `make_tartane.py` (hand-tuned), `make_crew.py` |
| Outputs | `public/models/ships/*`, `public/models/crew/*` (the scripts find the repo from `__file__`) |
| Gate | `tests/assets.test.ts` (GLB contract, see `SHIP_ASSETS.md`) + `npm run check` |

## How to run a generator (what the LLM is told to do)
The model's context is only 16k tokens, so **never ask it to write the script**: the scripts live on disk and the model runs a
fixed wrapper with one `execute_blender_code` call (the user approves each call; check the code first):

```python
p = "<repo or worktree>/tools/blender/make_tartane.py"
g = {"__name__": "__main__", "__file__": p}
exec(compile(open(p, encoding="utf-8").read(), p, "exec"), g)
result = g["RESULT"]
```

Prompt shape that works: English, one task, the exact code block, "do NOT write, plan or edit code", "reply with the result dict
only, on error report the text and stop". Open a **new chat per task**; long prompts and any reasoning about index orders make the
model loop (a 4.5k-token deliberation on vertex indices was the failure mode). Check results from disk (`ls`, parse the GLB), not
from the model's summary.

Both generators end with a `RESULT` dict, so the same wrapper works for `make_tartane.py` and `make_crew.py` (only the path changes).
Requirements: Blender 5.x (tested on 5.2.2 LTS) with its bundled glTF exporter and numpy, `blender-mcp` add-on enabled ("MCP Bridge Server" running), no extra pip packages.
Headless smoke test (about 5 s each) and success check: `blender -b --factory-startup --python tools/blender/make_tartane.py` must finish without a traceback and update
`public/models/ships/tartane.{glb,meta.json}`; then `npm run check` (the asset contract tests) must pass.

## Rules every generator must follow (learned the hard way)
1. **Do not touch the user's open scene.** Build inside `shipkit.Scratch()`: it snapshots datablocks, selection, active object and
   frame range, and on exit removes everything it created. Never `read_factory_settings`, never delete existing objects.
2. **Export only your own objects** with `use_selection=True`. Without it the GLB contained the user's other ships.
3. Names: `[A-Za-z0-9_-]` only; unique so Blender never appends `.001`.
4. Validate before exporting (`validate_ship`: names, per-LOD triangle budgets, ≤ 2 materials, sail pivots) and raise one clear `ValueError`.
5. Write `meta.json` next to the GLB; the game reads deck/obstacles/pivot from it, not from magic numbers.
6. Test headless first: `blender -b --factory-startup --python tools/blender/make_tartane.py`, then let the LLM run it in the GUI.
7. Re-run is idempotent (outputs overwritten, scratch objects removed). Dependencies: only `bpy`, `bmesh`, `numpy`, `mathutils`.

## Generic ships (`make_ships.py`)
`tools/blender/ships.json` is exported from `src/ships/specs.ts` (`npm run export:specs`; `tests/shipsJson.test.ts` fails when it is stale).
`shipbuilder.py` ports `hullShape`, `hull`, `castles`, `rig` (square, gaff, lug, lateen, spanker, shrouds, tops, pennant, bowsprit, jibs) and `details`
(gun ports, oars, stern windows, lanterns) and builds LOD0/1/2 per ship; it writes `<id>.glb`, `<id>.meta.json` (deck profile, one obstacle per mast and castle) and the atlas.
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
4. Let Llama run the wrapper with `IDS` (5 ships per call keeps each call fast; all 15 generic ships = 3 calls). Check the call's code before approving, then the result dict.
5. `npm run check`: `tests/assets.test.ts` checks every ship (names, budgets, materials, pivots on their mast, `specHash` equal to the current spec, deck and obstacle sanity).
6. Look at it in the browser: gallery, then `?perf&lod=0|1|2` in the sailing mode.
`make_tartane.py` stays the model for a hand-tuned ship (bespoke detail beyond what the spec describes); new ships should normally just use the generic builder.
A rig the builder does not know needs a new builder in `shipbuilder.py` (and `trim-…` pivots following the contract in `SHIP_ASSETS.md`).

## Crew
`make_crew.py` builds six body types × 3 LODs, a 12-bone rig, Idle/Walk/Run actions and a palette atlas; details in `CREW.md`.
Animations are authored in world axes and converted per bone (`key_pose`), so bone roll does not matter.

## Troubleshooting
- Llama UI "Server Error: stream resume produced no new bytes": transient; open a new chat and resend.
- Blender is not frontmost / a second Blender opened: the MCP bridge talks to the first instance only (socket 9876); do not launch another one.
- `fps 0` in `?perf` or in demos: the browser tab is in the background (requestAnimationFrame paused).
