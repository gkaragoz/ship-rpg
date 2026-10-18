import * as THREE from 'three';
import type { CastleSpec, ShipSpec } from './types';
import type { ShipMaterials } from './materials';
import { deckHeight, halfBeam, bulwark } from './hullShape';
import { buildGroupedGeometry, quadIndices } from './parts';

const STATIONS = 6;
const RING = 4;

export function buildCastles(spec: ShipSpec, mats: ShipMaterials): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  if (spec.sterncastle) out.push(...castle(spec, mats, spec.sterncastle, 'stern'));
  if (spec.forecastle) out.push(...castle(spec, mats, spec.forecastle, 'fore'));
  return out;
}

/** One mesh per tier; tiers step down in length and height. */
function castle(spec: ShipSpec, mats: ShipMaterials, c: CastleSpec, end: 'stern' | 'fore'): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  let lift = 0;
  const tiers = 1 + (c.stepped ?? 0);
  for (let n = 0; n < tiers; n++) {
    const length = c.length * (1 - 0.4 * n);
    const height = n === 0 ? c.height : c.height * 0.6;
    const t0 = end === 'stern' ? 0 : 1 - length;
    const t1 = end === 'stern' ? length : 1;

    const positions: number[] = [];
    for (let i = 0; i <= STATIONS; i++) {
      const t = t0 + ((t1 - t0) * i) / STATIONS;
      const x = (t - 0.5) * spec.length;
      const bottom = deckHeight(spec, t) - bulwark(spec) + lift;
      const w = halfBeam(spec, t) * 0.97;
      positions.push(x, bottom, -w, x, bottom + height, -w, x, bottom + height, w, x, bottom, w);
    }
    const walls: number[] = [];
    const top: number[] = [];
    for (let i = 0; i < STATIONS; i++) {
      walls.push(...quadIndices(i, 0, RING), ...quadIndices(i, 2, RING));
      top.push(...quadIndices(i, 1, RING));
    }
    const last = STATIONS * RING;
    walls.push(0, 1, 2, 0, 2, 3, last, last + 1, last + 2, last, last + 2, last + 3);

    const mesh = new THREE.Mesh(buildGroupedGeometry(positions, [walls, top]), [mats.hullMain, mats.deck]);
    mesh.name = `castle-${end}-${n}`;
    meshes.push(mesh);
    lift += height;
  }
  return meshes;
}
