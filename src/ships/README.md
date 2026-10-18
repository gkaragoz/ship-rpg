# ships

Procedural 3D ships from data. Depends on `core` only (and `three`).

Public API (`index.ts`): `SHIP_SPECS`, `getShipSpec(id)`, `createShip(spec, { flag? }) → { root, setSailTrim(windRel, level), setCondition(condition, time), dispose }` (the flag colour paints the masthead pennant and the stern ensign), types. `setSailTrim` braces yards, sheets fore-and-aft sails (eased by springs; trim groups are tagged `trim-square` / `trim-aft` in `rig.ts`) and furls by level; the optional `setWind({ angle, speed, gust })` feeds the apparent wind to belly, flutter and flags.

Files: `types.ts` schema · `specs.ts` data (16 ships + original stats) · `hullShape.ts` hull math · `hull.ts` loft + deck · `castles.ts` fore/stern castles · `rig.ts` masts, sails, bowsprit, jibs · `details.ts` gun ports, oars, stern windows, lanterns, stern flag · `materials.ts` · `parts.ts` mesh helpers · `factory.ts` assembly · `trim.ts` sail swing and state glue · `clothState.ts` pure springs and furl order · `clothGeometry.ts` load-time sail analysis · `clothShader.ts` sail/jib/yards vertex shader and depth · `clothRig.ts` which meshes get it (GLB and procedural) · `clothBake.ts` the shared baked flutter texture (`tools/cloth/`) · `flagCloth.ts` flag shader and strips · `glbShip.ts` / `lazyShip.ts` GLB ships.

Rules: add ships by adding data, not code; update `docs/SHIPS.md` and the 16-ship test. Always `dispose()` a ship you no longer show.

`setCondition` (`condition.ts`) shows damage per frame without allocating: sail colour/height and tiers (`sail-tier-<n>` groups in `rig.ts`), a `pivot` group inside `root` that sinks and lists with flooding, and a fixed pool of `flame` cones. On the procedural ship and the LOD1/LOD2 levels wind trim and damage both scale the trim groups' height (the product is applied); on LOD0 GLB sails damage is a tear in the cloth shader.

Cloth: LOD0 GLB sails and all flags are moved by vertex shaders (`docs/SHIPS.md`, "Sail and flag cloth"); the procedural ship scales its sails and waves its flags. `clothClock` is the time source of the sail springs (tests replace it).
