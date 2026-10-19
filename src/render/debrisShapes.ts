import * as THREE from 'three';

/** The shapes of the wreckage built in code (the fallback when the Blender prop set is not loaded). */

/** A tiny deterministic random generator for the shapes (so they are the same every run). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A plank about a metre long: a box with a tapered, torn end. */
export function plankGeometry(): THREE.BufferGeometry {
  const rand = lcg(7);
  const g = new THREE.BoxGeometry(1, 0.09, 0.2, 5, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const end = Math.max(0, Math.abs(x) - 0.3) / 0.2; // 0 in the middle, 1 at the ends
    p.setX(i, x + (rand() - 0.5) * 0.14 * end);
    p.setZ(i, p.getZ(i) * (1 - 0.45 * end * rand()) + (rand() - 0.5) * 0.05 * end);
    p.setY(i, p.getY(i) + (rand() - 0.5) * 0.03 * end);
  }
  g.computeVertexNormals();
  return g;
}

/** A thin jagged shard. */
export function splinterGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.0, 0.035, 0.55, 4, 1);
  g.rotateZ(Math.PI / 2);
  g.scale(1, 1, 0.6);
  return g;
}

/** A scrap of sailcloth: a crumpled plane. */
export function clothGeometry(): THREE.BufferGeometry {
  const rand = lcg(11);
  const g = new THREE.PlaneGeometry(0.8, 0.55, 4, 3);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, (rand() - 0.5) * 0.18);
    p.setX(i, p.getX(i) + (rand() - 0.5) * 0.08);
  }
  g.computeVertexNormals();
  return g;
}
