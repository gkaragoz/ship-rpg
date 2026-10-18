# world

Environment rules and static world data shared by gameplay, rendering and UI. Depends on `core` only.

- `wind.ts`: `windAt(time)` (deterministic wind), `sailEfficiency(angle)` (polar: 0 in irons … 1 broad reach), `NOMINAL_WIND`
- `sea.ts`: the sea surface as Gerstner waves (`WAVES`, `waveHeight`, `waveSlope`, `chop`), the sea state `seaStateAt(time, windSpeed)` 0 (glassy) … 1 (storm), `seaAmp`, `seaName`
- `clock.ts`: the time of day (`hourAt`, `startHourFor`, `sunState`: sun and moon directions, daylight, twilight, `formatHour`), a pure function of game time
- `weather.ts`: `weatherAt(time, overrides)`: the game's own weather with any part taken over by the weather simulator (wind, sea state, cloud, haze, rain, lightning, wave tuning), `WEATHER_PRESETS`
- `islands.ts`: `ISLANDS` (8, laid out like the original map), `terrainHeight(x, z)` (metres; negative = water depth; the single height function used everywhere), `WORLD_BOUNDS`
- `ports.ts`: `PORTS` (11) with `town`, `coast`, `anchor` (found by searching for a 9 m deep patch) and `getPort(id)`
- `nations.ts`: the six flags (`NATIONS`, `getNation`) with Turkish names and flag colours
- `noise.ts`: seeded `hash2`, `valueNoise`, `fbm`

Add an island or port by adding data to `ISLANDS`; `tests/islands.test.ts` checks spacing, a town on land and a deep anchorage for every port.
