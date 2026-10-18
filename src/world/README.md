# world

Environment rules and static world data shared by gameplay, rendering and UI. Depends on `core` only.

- `wind.ts`: `windAt(time)` (deterministic wind), `sailEfficiency(angle)` (polar: 0 in irons … 1 broad reach), `NOMINAL_WIND`
- `islands.ts`: `ISLANDS` (8, laid out like the original map), `terrainHeight(x, z)` (metres; negative = water depth; the single height function used everywhere), `WORLD_BOUNDS`
- `ports.ts`: `PORTS` (11) with `town`, `coast`, `anchor` (found by searching for a 9 m deep patch) and `getPort(id)`
- `noise.ts`: seeded `hash2`, `valueNoise`, `fbm`

Add an island or port by adding data to `ISLANDS`; `tests/islands.test.ts` checks spacing, a town on land and a deep anchorage for every port.
