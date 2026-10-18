# ships

Procedural 3D ships from data. Depends on `core` only (and `three`).

Public API (`index.ts`): `SHIP_SPECS`, `getShipSpec(id)`, `createShip(spec) → { root, dispose }`, types.

Files: `types.ts` schema · `specs.ts` data (16 ships + original stats) · `hullShape.ts` hull math · `hull.ts` loft + deck · `castles.ts` fore/stern castles · `rig.ts` masts, sails, bowsprit, jibs · `details.ts` gun ports, oars, stern windows · `materials.ts` · `parts.ts` mesh helpers · `factory.ts` assembly.

Rules: add ships by adding data, not code; update `docs/SHIPS.md` and the 16-ship test. Always `dispose()` a ship you no longer show.
