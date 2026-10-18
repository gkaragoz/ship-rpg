# Crew characters (reference assets)

Old-school (RuneScape-style) blocky low-poly sailors, built in Blender by the local **Llama + `blender-mcp`** pipeline. The game itself still generates ships procedurally; these GLBs are *not* in the repo (they live in `C:/blender_exports/crew/`) and are not wired into the game yet.

## Files (`C:/blender_exports/crew/`)
| File | What |
|---|---|
| `Male_Standard / Male_Broad / Male_Stout.glb` | male body types (normal, broad shoulders, round belly) |
| `Female_Standard / Female_Sturdy / Female_Stout.glb` | female body types (slim, sturdy, round) |
| `crew_atlas.png` | 256×256 grayscale detail atlas (face, stripes, cloth, leather, hair, felt); embedded in every GLB |
| `crew.json` | metadata: palettes, parts, LOD triangle counts, animation frame ranges |
| `make_crew.py` | the generator (run via Llama: `exec` the file with `__name__ == "__main__"` in `execute_blender_code`) |
| `demo.html` | three.js wander demo (serve the folder, e.g. `python -m http.server`) |

## Model
- 12 bones: `Root, Hips, Spine, Head, UpperArm/LowerArm/UpperLeg/LowerLeg .L/.R`; every piece is rigidly bound (one bone, weight 1.0).
- Heights 1.60–1.76 m. Space: **+Y up, characters face +Z** (rotate `root.rotation.y = atan2(dx, dz)` to steer).
- **LODs** as child groups `LOD0 / LOD1 / LOD2` (toggle `.visible`, share one skeleton): ~280–310 / 156 / 84 triangles. LOD0 also contains every optional part (hide the unused ones): `Hair_Short, Hair_Long, Beard, Hat_Wide, Hat_Bandana, Hat_Cap`.
- **Colour variety:** 7 materials (`Skin, Shirt, Pants, Boots, Belt, Hair, Hat`), each = atlas texture × `baseColorFactor`. Clone the materials per crew member and set `material.color` from `crew.json → palette` (see `demo.html`). Striped vs plain shirt is baked per variant (UV region).
- **Animations** (24 fps, in-place, looping): `Idle` 48 f, `Walk` 24 f (~1.4 m/s), `Run` 16 f (~3.6 m/s).

## three.js gotchas
- `GLTFLoader` strips dots from node names: bones are `UpperLegL`, not `UpperLeg.L`.
- Use `SkeletonUtils.clone` per instance and `mixer.clipAction(clip)`; do **not** set `action.weight = 0` to hide an action (effective weight = `weight × fade`, so it never fades in). Use `crossFadeTo` after `setEffectiveWeight(1)`.
- Blender's glTF exporter warns "Armature must be the parent of skinned mesh" because meshes sit under the LOD groups; skinning is correct anyway.
- Known limits: UVs are flat swatch/box projections, no normal maps; shoulders/hips are rigid blocks (fine for the art style).
