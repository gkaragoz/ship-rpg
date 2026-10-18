/**
 * Writes src/ships/specs.ts to tools/blender/ships.json, the data the Blender ship builder reads.
 * Run with `npm run export:specs` after changing a spec (tests/shipsJson.test.ts fails if it is stale).
 */
import { writeFileSync } from 'node:fs';
import { SHIP_SPECS } from '../src/ships/specs';

writeFileSync(new URL('./blender/ships.json', import.meta.url), `${JSON.stringify(SHIP_SPECS, null, 2)}\n`);
console.log(`wrote ${SHIP_SPECS.length} ship specs to tools/blender/ships.json`);
