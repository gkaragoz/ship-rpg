# Crew characters

Old-school (RuneScape-style) blocky low-poly sailors, built in Blender by the local **Llama + `blender-mcp`** pipeline (`tools/blender/make_crew.py`). They live in the repo under `public/models/crew/` and walk the deck of the player's ship in the sailing mode (`gameplay/crew.ts` decides where, `render/crew.ts` draws them). Contract and LOD policy: `SHIP_ASSETS.md`; how to regenerate: `BLENDER_PIPELINE.md`.

## Files (`public/models/crew/`)
| File | What |
|---|---|
| `Male_Standard / Male_Broad / Male_Stout.glb` | male body types (normal, broad shoulders, round belly) |
| `Female_Standard / Female_Sturdy / Female_Stout.glb` | female body types (slim, sturdy, round) |
| `crew_atlas.png` | 256×256 grayscale detail atlas (face, stripes, cloth, leather, hair, felt); embedded in every GLB |
| `crew.json` | metadata: palettes, parts, LOD triangle counts, animation frame ranges |
| `tools/blender/make_crew.py` | the generator (run via Llama, see `BLENDER_PIPELINE.md`) |

## Model
- 12 bones: `Root, Hips, Spine, Head, UpperArm/LowerArm/UpperLeg/LowerLeg .L/.R`; every piece is rigidly bound (one bone, weight 1.0).
- Heights 1.60–1.76 m. Space: **+Y up, characters face +Z** (rotate `root.rotation.y = atan2(dx, dz)` to steer).
- **LODs** as child groups `LOD0 / LOD1 / LOD2` (toggle `.visible`, share one skeleton): ~280–310 / 156 / 84 triangles. LOD0 also contains every optional part (hide the unused ones): `Hair_Short, Hair_Long, Beard, Hat_Wide, Hat_Bandana, Hat_Cap`.
- **Colour variety:** 7 materials (`Skin, Shirt, Pants, Boots, Belt, Hair, Hat`), each = atlas texture × `baseColorFactor`. Clone the materials per crew member and set `material.color` from `crew.json → palette` (see `src/render/crew.ts`). Striped vs plain shirt is baked per variant (UV region).
- **Animations** (24 fps, in-place, looping): `Idle` 48 f, `Walk` 24 f (~1.4 m/s), `Run` 16 f (~3.6 m/s).

## three.js gotchas
- `GLTFLoader` strips dots from node names: bones are `UpperLegL`, not `UpperLeg.L`.
- Use `SkeletonUtils.clone` per instance and `mixer.clipAction(clip)`; do **not** set `action.weight = 0` to hide an action (effective weight = `weight × fade`, so it never fades in). Use `crossFadeTo` after `setEffectiveWeight(1)`.
- Blender's glTF exporter warns "Armature must be the parent of skinned mesh" because meshes sit under the LOD groups; skinning is correct anyway.
- Known limits: UVs are flat swatch/box projections, no normal maps; shoulders/hips are rigid blocks (fine for the art style).

## Crews of every ship, work on deck, swimmers (all for show)
- **Every ship with a GLB deck has a visible crew** while it is within 220 m of the player (`gameplay/shipCrews.ts`: enemies and patrols, one `createCrew` each, created on first sight, stepped only while looked at, forgotten after 40 s). `EnemyView.crew` and `OtherShipView.crew` carry the sailors; `render/shipCrews.ts` gives each ship its own crew renderer on the ship model.
- **Work on deck** (`gameplay/crew.ts` jobs, `crewLayout.ts` the stations, `crewData.ts` `JOBS` the timings): the first sailor stands at the helm and turns the wheel with the rudder; a change of the sail target sends a climber up each mast (`Climb` up to 9 m, `Aloft` on the yard, `Climb` back) and a hauler to the halyards (`Haul`); a broadside sends up to three gunners to the rail of that side to `Fire` and then `Load` for the reload time (enemies: noticed from their reload jumping). Nothing here changes the game; a sailor boxed in on the way simply appears at its job.
- **Poses** (`render/crewPoses.ts`): the new animations are not clips but bone rotations laid over the idle clip every frame from the rest rotations (`findBones`, `applyPose`); the clock and parameter come in `CrewView.clock` and `lean` (helm: the rudder; climb: progress; fire: recoil; swim: tiredness). `?pose=Helm|Haul|Climb|Aloft|Load|Fire|Fly|Swim|Drown` in the gallery URL puts sailors on the deck in that pose.
- **Swimmers** (`render/swimmerSim.ts` pure sim, `render/swimmers.ts` drawing): about a third of the hull hits (a tenth of rigging hits) above the waterline fling a sailor off the deck, and a sinking ship spills 4-14 sailors over two seconds (`GameEvent.length`). Each tumbles through the air with flailing limbs (gravity, drag, spin: a one-point rag doll whose limbs the `Fly` pose flails), splashes, swims at the surface with slow strokes that tire, then drowns (goes slack and sinks 3 m in 5 s) and is removed. At most 48 at once. In dev, `__swimmers.spawn([...])` throws some by hand.

Pose axes (checked close up with `?pose=<Name>&closeup=9` in the gallery): the arm and leg bones are authored flipped, so a negative x rotation (`FORWARD` in `crewPoses.ts`) raises an arm forward and up and swings a leg forward; z spreads the arms out. Helm, Load and Fire reach forward, Climb and Drown raise the arms, Aloft spreads them, Fly and Swim flail: all read correctly from the side.
