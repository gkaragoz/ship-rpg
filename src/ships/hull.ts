import * as THREE from 'three';
import type { ShipSpec } from './types';
import type { ShipMaterials } from './materials';
import { deckHeight, halfBeam, sectionPoint } from './hullShape';
import { buildGroupedGeometry, quadIndices } from './parts';

const STATIONS = 28;
const SEGMENTS = 16;
/** Deck sits this far below the bulwark top. */
export const BULWARK = 0.45;

/** Lofted hull (lower / main / wale material groups) plus the deck. */
export function buildHull(spec: ShipSpec, mats: ShipMaterials): THREE.Group {
  const ringSize = SEGMENTS + 1;
  const positions: number[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    for (let j = 0; j <= SEGMENTS; j++) {
      const p = sectionPoint(spec, i / STATIONS, j / SEGMENTS);
      positions.push(p.x, p.y, p.z);
    }
  }

  const lower: number[] = [];
  const main: number[] = [];
  const wale: number[] = [];
  for (let i = 0; i < STATIONS; i++) {
    for (let k = 0; k < SEGMENTS; k++) {
      const fromTop = Math.min(k, SEGMENTS - 1 - k);
      const set = fromTop === 1 ? wale : fromTop >= 3 ? lower : main;
      set.push(...quadIndices(i, k, ringSize));
    }
  }

  // Close the transom with a fan around the stern ring's centroid.
  const center = positions.length / 3;
  const c = new THREE.Vector3();
  for (let j = 0; j <= SEGMENTS; j++) {
    c.add(new THREE.Vector3(positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]));
  }
  c.divideScalar(ringSize);
  positions.push(c.x, c.y, c.z);
  for (let j = 0; j < SEGMENTS; j++) main.push(center, j + 1, j);

  const hull = new THREE.Mesh(buildGroupedGeometry(positions, [lower, main, wale]), [
    mats.hullLower,
    mats.hullMain,
    mats.wale,
  ]);
  hull.name = 'hull';

  const group = new THREE.Group();
  group.add(hull, buildDeck(spec, mats));
  return group;
}

function buildDeck(spec: ShipSpec, mats: ShipMaterials): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const x = (t - 0.5) * spec.length;
    const y = deckHeight(spec, t) - BULWARK;
    const w = halfBeam(spec, t) * 0.95;
    positions.push(x, y, -w, x, y, w);
  }
  for (let i = 0; i < STATIONS; i++) indices.push(...quadIndices(i, 0, 2));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const deck = new THREE.Mesh(geometry, mats.deck);
  deck.name = 'deck';
  return deck;
}
