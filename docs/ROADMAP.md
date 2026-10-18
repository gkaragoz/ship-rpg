# Roadmap

- [x] 1. Skeleton: Vite + TS, lint/test, context docs, QA agent
- [x] 2. Ship gallery: all 16 ships rotating, selectable, with original-game stats
- [x] 3. Ocean + wind + playable ship (wave ocean, sky, wind and polar, chase camera, HUD)
  - [ ] polish: ship wake and foam
  - [ ] polish: sails luff when in irons
  - [ ] polish: sound (wind, water, creak)
  - [ ] tuning pass on turn rate, acceleration and speed scale by playing
  - [ ] tests for HUD bearing maths and the wave-riding sampling
  - [ ] sea detail: far water looks soft/smeared (flat-shaded 2.5 m grid); add a fine normal layer or foam
  - [ ] touch controls (no on-screen steering, sails or exit on mobile yet)
  - [ ] measure frame rate on a real browser/GPU (the embedded pane throttles rAF, so 60 fps is unverified; ocean is 360×360 segments)
- [ ] 4. Islands, ports, navigation
- [ ] 5. Combat, trade, RPG layer
