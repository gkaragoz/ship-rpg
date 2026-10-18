# world

Environment rules and static world data shared by gameplay, rendering and UI. Depends on `core` only.

- `wind.ts`: `windAt(time)` (deterministic wind), `sailEfficiency(angle)` (polar: 0 in irons … 1 broad reach), `NOMINAL_WIND`, `gustAt(x, z, time, wind)` (bands of stronger and weaker air drifting downwind, 0.75–1.25) and `apparentWind(wind, heading, speed)` (the wind a moving ship feels)
- `sea.ts`: the sea surface as Gerstner waves (`WAVES`, `waveHeight`, `waveSlope`, `chop`), the sea state `seaStateAt(time, windSpeed)` 0 (glassy) … 1 (storm), `seaAmp`, `seaName`
- `clock.ts`: the time of day (`hourAt`, `startHourFor`, `sunState`: sun and moon directions, daylight, twilight, `formatHour`), a pure function of game time
- `weather.ts`: `weatherAt(time, overrides)`: the game's own weather with any part taken over by the weather simulator (wind, sea state, cloud, haze, rain, lightning, wave tuning), `WEATHER_PRESETS`
- `islands.ts`: `ISLANDS` (8, laid out like the original map), `terrainHeight(x, z)` (metres; negative = water depth; the single height function used everywhere), `WORLD_BOUNDS`
- `ports.ts`: `PORTS` (11) with `town`, `coast`, `anchor` (found by searching for a 9 m deep patch) and `getPort(id)`
- `nations.ts`: the six flags (`NATIONS`, `getNation`) with Turkish names and flag colours
- `goods.ts`: the ten trade goods (`GOODS`, `getGood`) with Turkish names and base prices in gold
- `noise.ts`: seeded `hash2`, `valueNoise`, `fbm`

Add an island or port by adding data to `ISLANDS`; `tests/islands.test.ts` checks spacing, a town on land and a deep anchorage for every port.

`ports.ts` also defines each port's **entry zone** (`PORT_ZONE`, `insidePortZone`, `portZoneCorners`): a 110 x 90 m rectangle across the anchorage that reaches further out to sea than towards the shore. A ship docks (`F`) only from inside it and slower than `DOCK.maxSpeed`; the sea view draws it (`render/portZones.ts`: gold border ribbon and corner posts following the waves, an anchor sign) and the minimap and chart mark every port with an anchor (`ui/anchorIcon.ts`).
