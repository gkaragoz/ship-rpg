# Conventions

- TypeScript strict; no `any`; explicit return types on exported functions.
- Files: `camelCase.ts`, one concept per file, under ~300 lines.
- Each module exposes only `index.ts`; internals are not imported from outside.
- Game constants in data files, not scattered literals. Units: metres, seconds, radians.
- Simulation uses the fixed step; never use wall-clock time in game logic.
- Dispose three.js geometries/materials/textures you create.
- Tests (vitest) in `tests/`, named `<area>.test.ts`; logic must be testable without WebGL.
- Comments explain why, not what.
