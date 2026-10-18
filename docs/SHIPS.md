# Ships (single source of truth)

16 period ships (17th–18th century Caribbean), ordered roughly small → large. Parametric fields feed `ships/factory`: hull length, masts, rig per mast (square / lateen / gaff / jib), castle heights, gun count.

| # | Type | Class | Masts | Rig | Notes |
|---|---|---|---|---|---|
| 1 | Tartane | small | 1 | lateen | Mediterranean fisher/trader |
| 2 | Yacht | small | 1 | gaff | fast, light |
| 3 | Lugger | small | 2 | lugsail | smuggler |
| 4 | Sloop | small | 1 | gaff + jib | pirate favourite |
| 5 | Schooner | medium | 2 | fore-and-aft | fast, weatherly |
| 6 | Barque | medium | 3 | square fore/main, fore-and-aft mizzen | cargo |
| 7 | Xebec | medium | 3 | lateen | Mediterranean raider, oars |
| 8 | Galeoth | medium | 2 | lateen/square | oared galley hybrid |
| 9 | Caravel | medium | 3 | lateen (+square fore) | exploration era |
| 10 | Fleut | medium | 3 | square | big cargo hold, weak guns |
| 11 | Brig | medium | 2 | square | versatile warship |
| 12 | Pinnace | medium | 3 | square | escort/light cargo |
| 13 | Corvette | large | 3 | square | fast warship |
| 14 | Galleon | large | 3–4 | square + lateen mizzen | high stern castle |
| 15 | Frigate | large | 3 | full square | fast, strong |
| 16 | Battleship | large | 3 | full square | 3 gun decks, flagship |

Numeric stats (speed, guns, cargo, crew) are added to `src/ships/specs` and mirrored here when implemented. Sketches: side-view silhouettes for Sloop, Brig, Galleon, Frigate were approved as style reference (flat hull with gold wale, cream sails, red pennant).
