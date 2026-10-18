# Ships (single source of truth)

16 period ships (17th–18th century Caribbean). Code: `src/ships/specs.ts` (data) and `src/ships/types.ts` (schema, units, field docs). This table mirrors the data; update both together. Tests (`tests/ships.test.ts`) guard the 16-ship set.

## Original-game stats
Source: GameFAQs "Pirates of the Caribbean – Data Tables" by DrdLord (v1.1, updated 2004-03-24), PC version, shipyard table. Stat numbers only are used; guide text is not copied. Values are the approximate **base** before each shipyard's regional modifiers (about ±5% for hp/speed/turn, up to ±10% for hold and crew). Where the guide lists several yards we infer the base; Galleon and Battleship have no clear base, so we take the median per column (Galleon turn is the exception: 25, the ×1.05-corrected base). Fleut and Frigate have a single row in the guide, so their values are used as listed and are not base-corrected (Fleut speed 10.5, Frigate speed 14.7). Price is the guide's `$` column (unit not stated, likely thousands).

| Class | Ship | HP | Speed | Turn | Hold | Crew | Officers | Cannons × lb | Price |
|---|---|---|---|---|---|---|---|---|---|
| 7 | Tartane | 100 | 7 | 50 | 50 | 12 | 3 | 0 | 5 |
| 6 | Barque | 760 | 7 | 25 | 1200 | 80 | 16 | 16 × 12 | 18 |
| 6 | Yacht | 700 | 9 | 30 | 800 | 60 | 12 | 16 × 12 | 19 |
| 6 | Lugger | 500 | 16 | 60 | 500 | 52 | 10 | 12 × 12 | 20 |
| 5 | Sloop | 1200 | 10 | 40 | 800 | 100 | 20 | 16 × 12 | 25 |
| 5 | Galeoth | 1000 | 13 | 35 | 700 | 90 | 18 | 16 × 12 | 27 |
| 5 | Xebec | 1500 | 10 | 45 | 1000 | 100 | 20 | 20 × 16 | 30 |
| 4 | Schooner | 1800 | 12 | 35 | 1200 | 120 | 24 | 20 × 16 | 35 |
| 4 | Caravel | 2500 | 8 | 25 | 2500 | 240 | 48 | 32 × 12 | 45 |
| 4 | Fleut | 2850 | 10.5 | 35 | 2800 | 257 | 54 | 20 × 16 | 55 |
| 3 | Pinnace | 4000 | 11 | 30 | 3200 | 300 | 60 | 24 × 16 | 70 |
| 3 | Brig | 2500 | 14 | 40 | 1500 | 160 | 32 | 24 × 16 | 80 |
| 3 | Galleon | 5000 | 7 | 25 | 4000 | 477 | 94 | 38 × 16 | 90 |
| 2 | Corvette | 4000 | 16 | 45 | 2000 | 200 | 40 | 32 × 24 | 120 |
| 2 | Frigate | 5700 | 14.7 | 40 | 2500 | 380 | 80 | 44 × 24 | 150 |
| 1 | Battleship | 10000 | 12.6 | 30 | 5000 | 618 | 130 | 70 × 24 | 200 |

### Consistency notes (checked against the guide)
- The class number is a **tier**, not a physical size: Barque, Yacht and Lugger are all class 6.
- Stats are not monotonic in class; this is the original game's balance, kept as-is: Lugger (16) is as fast as a Corvette; Caravel has more cannons (32) than Brig or Pinnace (24) and more crew than Brig (240 vs 160); Galleon is joint-slowest (speed 7, with Tartane and Barque); in the guide's best Galleon yard its HP (5700) equals the Frigate's; Yacht carries 16 cannons; Tartane has none.
- Cannon count drives the number of visible gun ports; `gunDecks` is a visual-only row count.
- Gameplay balance may later be tuned independently of the original; keep this table as the reference.
- Copyright: the guide is © its author and the game data © the game's publisher. Fine for a prototype; derive our own numbers before any public release.

## Visual spec (see `types.ts`)
`length` is the station length of the hull; stem and transom lean make the overall mesh about 7% longer (e.g. Battleship 64 → ~68.5 m). Use the mesh bounds, not `length`, for docking or collision.

Ship local space: metres, +x bow, +y up, waterline y = 0. Hull is lofted from stations (stern → bow); `masts[].at` runs bow (0) → stern (1). Rigs: `square` (1–3 tiers, optional spanker), `lateen`, `gaff`, `lug`. Sketch reference style: dark hull with gold wale, cream sails, red pennant.

| Ship | Masts × rig | Castles |
|---|---|---|
| Tartane | 1 lateen | – |
| Yacht | 1 gaff | – |
| Lugger | 2 lug | – |
| Sloop | 1 gaff | – |
| Schooner | 2 gaff | – |
| Barque | 2 square + 1 gaff | small stern |
| Xebec | 3 lateen, 10 oars/side | – |
| Galeoth | 2 lateen, 12 oars/side | small stern |
| Caravel | 2 square + 1 lateen | fore + stern |
| Fleut | 2 square + 1 lateen | stern |
| Pinnace | 2 square + 1 lateen | stern |
| Brig | 2 square (spanker on main) | small stern |
| Galleon | 2 square + 2 lateen | fore + stepped stern |
| Corvette | 3 square (spanker) | small stern |
| Frigate | 3 square (spanker) | stern |
| Battleship | 3 square (spanker) | fore + stern |

## Tartane (Blender GLB, 3 LODs)
The tartane is the first ship made in Blender through the Llama + `blender-mcp` pipeline (`tools/blender/make_tartane.py`), shipped as
`public/models/ships/tartane.glb` + `tartane.meta.json` and used by the gallery and the sailing mode (procedural fallback). Same local
space as above. Contract, budgets and LOD policy: `SHIP_ASSETS.md`.

| Item | Value |
|---|---|
| Hull | 15 stations, L 12.0 · B 3.96 · draft 1.2 · freeboard 1.35 · sheer 0.7 (matches `specs.ts`) |
| Mesh bounds | x −6.3…8.0 (rudder → bowsprit), y −1.2…11.4 (keel → yard tip; mast top 11.0), z ±1.98 |
| Rig | 1 mast at x 0.96, lateen yard on a `trim-aft` pivot (~47° from horizontal, low end forward), jib, stays, shrouds |
| LOD0 (hero) | 1,886 tris, 3 draw calls: hull, deck + seams, rail, wale, planks, rivets, rudder/tiller, hatch, barrels, anchor, lantern |
| LOD1 | 317 tris, 2 draw calls (no seams/rivets/props, coarser sail) |
| LOD2 | 95 tris, 2 draw calls (silhouette) |
| Materials | `tartane_atlas_mat` (256² flat swatches) + emissive `tartane_glass` |
| Deck | `meta.json`: deck profile per station, obstacles (mast, hatch, barrels, anchor, tiller, lantern pole) |

Also on that deck: the crew (`CREW.md`).
