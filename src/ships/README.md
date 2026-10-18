# ships

Procedural 3D ships from data. Depends on `core` only (and `three`).

Public API (`index.ts`): `SHIP_SPECS`, `getShipSpec(id)`, `createShip(spec, { flag? }) → { root, setSailTrim(windRel, level), dispose }` (the flag colour paints the masthead pennant and the stern ensign), types. `setSailTrim` braces yards, sheets and mirrors fore-and-aft sails to leeward and reefs by level (trim groups are tagged `trim-square` / `trim-aft` in `rig.ts`).

Files: `types.ts` schema · `specs.ts` data (16 ships + original stats) · `hullShape.ts` hull math · `hull.ts` loft + deck · `castles.ts` fore/stern castles · `rig.ts` masts, sails, bowsprit, jibs · `details.ts` gun ports, oars, stern windows, lanterns, stern flag · `materials.ts` · `parts.ts` mesh helpers · `factory.ts` assembly.

Rules: add ships by adding data, not code; update `docs/SHIPS.md` and the 16-ship test. Always `dispose()` a ship you no longer show.
