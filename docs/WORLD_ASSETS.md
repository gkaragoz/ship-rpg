# World assets (buildings, trees, rocks, boats)

Low-poly props for the islands and port towns, built by `tools/blender/make_world.py` (the same Blender pipeline as the ships and
crew, see `BLENDER_PIPELINE.md`) into **one GLB**: `public/models/world/world.glb` + `world.meta.json` + the editable colour atlas
`world_atlas.png`. Nothing in the game depends on it: without the file the scenery falls back to boxes and cones (`render/scenery.ts`).

## Contract
- One material (`world`, a 16-swatch flat-colour atlas, nearest filtering, rough 0.9), 29 props, each as two top-level meshes
  `<Prop>_LOD0` (whole prop, at most 900 triangles) and `<Prop>_LOD1` (the far version: boxes and cones only, under 65 % of
  LOD0, except the tiny ones). Names use letters, digits, `_` and `-` only. The file stays under 600 KB.
- Metres. Origin on the ground at the prop's centre, +Y up, **a building's front and door toward +X**. Rocks, trees and boats
  have no front. The generator writes the footprint and height of every prop to `world.meta.json` (`size` = x, height, depth).
- The props: houses by nation (`HouseEnglish` white clapboard and slate gable, `HouseFrench` cream with blue shutters and a
  hipped slate roof, `HouseSpanish` ochre adobe with beam ends and a tiled parapet, `HouseDutch` brick with a stepped gable,
  `Shack` on stilts), `Tavern` (an English house with a hanging sign), `Warehouse`, `Church` (bell tower and spire), `Fort`
  (curtain walls, four round towers, gate, barracks, flag), `Lighthouse`, `Windmill`, `Crane`, `MarketStall`, `WatchTower`,
  `PierPlank` (8 m of deck on piles); nature: `PalmA`, `PalmB`, `Broadleaf`, `Pine`, `Bush`, `RockA/B/C`; boats: `Rowboat`,
  `Canoe`, `FishingBoat`; clutter: `BarrelStack`, `CrateStack`, `CannonProp`.

## In the game
- `render/worldKit.ts` loads the GLB once at start (`loadWorldAssets`, alongside the ships and crew) and hands out geometry by
  prop and level.
- `render/townPlan.ts` (pure, deterministic, tested) plans what goes where: a port's `nation` (`PortDef.nation`, `world/islands.ts`)
  picks its houses, a church or windmill, the Forts and Lighthouses of the headland ports, market stalls, barrels, a pier of planks
  out over the water with a crane and moored boats; an island's trees by height and slope (palms on the beach, broadleaf trees,
  pines up the slope, bushes, rocks on the coast and the peaks), kept clear of the towns.
- `render/worldInstances.ts` draws every prop as one `InstancedMesh` per level (a brightness tint per instance); `Scenery.update`
  shows the whole props within about 480 m of a town or island and the cheap ones beyond.
- Regenerate: headless `blender -b --factory-startup --python tools/blender/make_world.py`, or by the Llama wrapper of
  `BLENDER_PIPELINE.md`; then `npm run check` (`tests/worldKit.test.ts` checks the GLB against the meta and the plans).
