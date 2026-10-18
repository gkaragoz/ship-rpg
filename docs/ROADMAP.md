# Roadmap

- [x] 1. Skeleton: Vite + TS, lint/test, context docs, QA agent
- [x] 2. Ship gallery: all 16 ships rotating, selectable, with original-game stats (visual polish ongoing: hull proportions, sail trim, wave sea)
- [x] 2b. Tartane as a Blender GLB with 3 LODs, used in gallery and sailing (Llama + blender-mcp; `docs/SHIP_ASSETS.md`); procedural fallback kept
- [x] 2c. Crew: 6 rigged body types, 3 LODs, Idle/Walk/Run, tintable; wandering on the player's deck; 4 NPC patrol ships with distance LOD (`docs/CREW.md`, `docs/BLENDER_PIPELINE.md`)
- [ ] 2d. Remaining 15 ships as Blender GLBs via Llama (port `hullShape.ts` to Python, `ShipSpec` → JSON), NPC fleets beyond the tartane
- [ ] 3. Ocean + wind + playable ship
- [ ] 4. Islands, ports, navigation
- [ ] 5. Combat, trade, RPG layer
