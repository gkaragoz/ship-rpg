# Blender pipeline (Llama + `blender-mcp`)

How the tartane and the crew were produced, so the other 15 ships (and more crew) can be made the same way.

## Pieces
| Piece | Where |
|---|---|
| Model | `llama-server` (Gemma 4 26B-A4B, 16k context, port 8080) with its web UI |
| Bridge | `blender-mcp --transport http --port 9191` ↔ Blender add-on (socket 9876); `C:/blender_mcp`, tools such as `execute_blender_code` |
| Scripts | `tools/blender/` in this repo: `shipkit.py` (helpers), `make_tartane.py`, `make_crew.py` |
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

## Adding another ship
(`make_tartane.py` is tartane-specific today: lateen rig, `trim-aft` only. Square rigs need new builders and `trim-square` pivots; the helpers in `shipkit.py` are generic.)
1. Copy `make_tartane.py`; replace `SHIP` (dimensions, station tables, mast/yard/jib positions), `SWATCHES`, and `LOD_CFG` if the rig differs
   (square rigs need `trim-square` pivots and a tier builder).
2. Keep the LOD ladder idea: LOD0 = hero (all detail, merged by material), LOD1 ≈ 1/6 of the triangles, LOD2 ≈ silhouette; budgets scale with `length`.
3. Add the id to `GLB_SHIP_IDS` in `src/ships/assets.ts`, extend `tests/assets.test.ts` (it hard-codes the tartane budgets 2000/450/130; add a per-ship table), run `npm run check` and look at it in the browser (`?perf&lod=N`).
4. Next step for the whole fleet: port `src/ships/hullShape.ts` (`halfBeam`, `deckHeight`, `keelHeight`, `sectionPoint`) to Python and export `ShipSpec` as JSON so
   `make_ship.py <id>` builds any ship with the same proportions as the procedural one.

## Crew
`make_crew.py` builds six body types × 3 LODs, a 12-bone rig, Idle/Walk/Run actions and a palette atlas; details in `CREW.md`.
Animations are authored in world axes and converted per bone (`key_pose`), so bone roll does not matter.

## Troubleshooting
- Llama UI "Server Error: stream resume produced no new bytes": transient; open a new chat and resend.
- Blender is not frontmost / a second Blender opened: the MCP bridge talks to the first instance only (socket 9876); do not launch another one.
- `fps 0` in `?perf` or in demos: the browser tab is in the background (requestAnimationFrame paused).
