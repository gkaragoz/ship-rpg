import * as THREE from 'three';
import { column, components, type SailAnalysis, type SailTier } from './clothGeometry';

/** Attributes for the rigging that follows a sail: yards, footropes and boltropes of square sails, booms and gaffs of fore-and-aft sails. */

/**
 * Add the cloth attributes to the yards mesh of a square-sail mast: each part (yard, footrope, boltrope, lift …) is a
 * connected piece and belongs to the tier it starts in; it is then gathered by the shader like that tier's sail
 * (no belly), except the part within a yard's thickness of the head line, so the yards stay where they are.
 */
export function prepareYards(geometry: THREE.BufferGeometry, tiers: SailTier[], seed: number, slotOffset = 0): void {
  if (geometry.getAttribute('clothA')) return;
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const index = geometry.getIndex();
  if (!pos || !index || tiers.length === 0) return;
  const n = pos.count;
  const { label, count } = components(index.array, n);
  const minY = new Float64Array(count).fill(Infinity);
  for (let v = 0; v < n; v++) minY[label[v] as number] = Math.min(minY[label[v] as number] as number, pos.getY(v));
  const tierOf = (y: number): number => {
    let k = 0;
    tiers.forEach((t, i) => {
      if (t.yBot <= y + 0.06) k = i;
    });
    return k;
  };
  const A = new Float32Array(n * 4);
  const B = new Float32Array(n * 4);
  const C = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const k = tierOf(minY[label[v] as number] as number);
    const t = tiers[k] as SailTier;
    const height = Math.max(t.yTop - t.yBot, 1e-3);
    A.set([11 + slotOffset + k, (pos.getY(v) - t.yBot) / height, 0.5, 0], v * 4);
    B.set([t.yTop, height, 1, seed], v * 4);
    C[v * 4 + 3] = 1;
  }
  geometry.setAttribute('clothA', new THREE.BufferAttribute(A, 4));
  geometry.setAttribute('clothB', new THREE.BufferAttribute(B, 4));
  geometry.setAttribute('clothC', new THREE.BufferAttribute(C, 4));
}

/**
 * Booms, gaffs and yards of a fore-and-aft sail follow it: every vertex is placed between the sail's head and foot
 * lines at its x, so the gaff (on the head line) stays and the boom (on the foot line) is lifted as the sail is furled.
 */
export function prepareAftYards(geometry: THREE.BufferGeometry, sail: SailAnalysis, seed: number): void {
  if (geometry.getAttribute('clothA')) return;
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const env = sail.envelope;
  if (!pos || !env) return;
  const n = pos.count;
  const width = Math.max(env.range[1] - env.range[0], 1e-3);
  const A = new Float32Array(n * 4);
  const B = new Float32Array(n * 4);
  const C = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const x = pos.getX(v);
    const col = column(env, x, pos.getY(v));
    A.set([14, (pos.getY(v) - col.bot) / col.height, Math.min(Math.max((env.range[1] - x) / width, 0), 1), 0], v * 4);
    B.set([col.top, col.height, width, seed], v * 4);
    C[v * 4 + 3] = 1;
  }
  geometry.setAttribute('clothA', new THREE.BufferAttribute(A, 4));
  geometry.setAttribute('clothB', new THREE.BufferAttribute(B, 4));
  geometry.setAttribute('clothC', new THREE.BufferAttribute(C, 4));
}
