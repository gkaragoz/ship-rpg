# Third-party notices

Each component below is under its own license; **the commercial-use restriction of the main project (`LICENSE`) does not apply to them**, their own terms do.

## Runtime dependencies

| Package | License | Use |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) 0.170 | MIT | 3D rendering, GLB loading, the meshopt decoder (`three/examples/jsm`) |

## Development dependencies

[Vite](https://github.com/vitejs/vite) (MIT), [Vitest](https://github.com/vitest-dev/vitest) (MIT), [TypeScript](https://github.com/microsoft/TypeScript) (Apache-2.0), [ESLint](https://github.com/eslint/eslint) and typescript-eslint (MIT / Apache-2.0).

## Tools (not shipped with the game)

[Blender](https://www.blender.org) (GPL, used only to build the models; its output is not covered by the GPL) and a local Llama model driven through `blender-mcp` build the GLB files under `public/models`.

## Game content

Ship specifications, the 3D models, the world and the sounds (synthesized with Web Audio, no audio files) are original to this project and covered by the project license.
