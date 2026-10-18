/**
 * Writes the shared cloth flutter bake: public/models/cloth/flutter.bin (binary16 RGBA texels, layer-major) and
 * flutter.meta.json. Deterministic: the same code always writes the same bytes. Run with
 * `npm run bake:cloth` (vite-node) after changing `solver.ts`; tests/clothBake.test.ts fails while the files are stale.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  BANDS,
  FLAG_ASPECT,
  FLAG_FIRST,
  FOLD_LAYER,
  FRAMES,
  GRID_H,
  GRID_W,
  LAYERS,
  LEVEL_PEAK,
  SEED,
  buildBake,
  hashBake,
} from './solver';

const dir = new URL('../../public/models/cloth/', import.meta.url);
mkdirSync(dir, { recursive: true });
const data = buildBake();
writeFileSync(new URL('flutter.bin', dir), new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
const meta = {
  version: 1,
  format: 'rgba16f',
  width: GRID_W,
  height: GRID_H,
  frames: FRAMES,
  layers: LAYERS,
  bands: BANDS,
  levels: 2,
  levelPeak: LEVEL_PEAK,
  foldLayer: FOLD_LAYER,
  flagFirst: FLAG_FIRST,
  flagAspect: FLAG_ASPECT,
  seed: SEED,
  bytes: data.byteLength,
  hash: hashBake(data),
  layout: 'layer = (band * 2 + level) * frames + frame for sails; foldLayer: static folds; flagFirst + level * frames + frame for flags. texel = (z, dz/dx, dz/dy, 0)',
};
writeFileSync(new URL('flutter.meta.json', dir), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`wrote ${data.byteLength} bytes, hash ${meta.hash}`);
