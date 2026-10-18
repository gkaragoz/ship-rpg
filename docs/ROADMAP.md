# Roadmap

- [x] 1. Skeleton: Vite + TS, lint/test, context docs, QA agent
- [x] 2. Ship gallery: all 16 ships rotating, selectable, with original-game stats (visual polish ongoing: hull proportions, sail trim, wave sea)
- [x] 2b. Tartane as a Blender GLB with 3 LODs, used in gallery and sailing (Llama + blender-mcp; `docs/SHIP_ASSETS.md`); procedural fallback kept
- [x] 2c. Crew: 6 rigged body types, 3 LODs, Idle/Walk/Run, tintable; wandering on the player's deck; 4 NPC patrol ships with distance LOD (`docs/CREW.md`, `docs/BLENDER_PIPELINE.md`)
- [x] 2d. All 16 ships as Blender GLBs with 3 LODs, generated through Llama from `ShipSpec` JSON (`tools/blender/shipbuilder.py`); NPC patrols mix tartane/sloop/brig/galleon
- [x] 2e. Hero details on LOD0 (muzzles, rudder, anchors, ratlines, hatch, smooth sails) and a 12-ship NPC fleet
- [ ] 2f. Per-ship polish (figureheads, boats, stern galleries), lazy GLB loading, NPC steering instead of fixed ellipses
- [ ] 3. Ocean + wind + playable ship
- [ ] 4. Islands, ports, navigation
- [ ] 5. Combat, trade, RPG layer
