import * as THREE from 'three';
import type { Quality } from './quality';

/** The sea mesh must reach past the fog (`FOG_FAR`), beyond which it is invisible anyway. */
export const SEA_REACH = 3000;

/** Cells the hole of an outer level is smaller than the finer level inside it, so the two always overlap. */
const HOLE_MARGIN = 2;

/** Number of clip-map levels so the outermost reaches `SEA_REACH` (each level doubles in size). */
export function levelCount(q: Quality, reach = SEA_REACH): number {
  let n = 1;
  while ((q.grid * q.cell * 2 ** (n - 1)) / 2 < reach) n++;
  return n;
}

/** Cell size (m) of level `i` (0 = finest). */
export const levelCell = (q: Quality, i: number): number => q.cell * 2 ** i;

/** Cells across the hole in every level but the finest. */
export const holeCells = (q: Quality): number => q.grid / 2 - HOLE_MARGIN;

/** Triangles in the whole sea for a quality (the budget the tests check). */
export function seaTriangles(q: Quality, reach = SEA_REACH): number {
  const full = q.grid * q.grid;
  const ring = full - holeCells(q) ** 2;
  return 2 * (full + ring * (levelCount(q, reach) - 1));
}

/** Centre of a level for a camera at `x`: a multiple of the level's own cell size, so its vertices never slide. */
export const snap = (x: number, cell: number): number => Math.round(x / cell) * cell;

/**
 * A flat square grid of `n × n` cells in cell units (one unit = one cell), lying in the x-z plane and
 * centred on the origin. With `hole` > 0 the central `hole × hole` cells are left out.
 */
export function gridGeometry(n: number, hole = 0): THREE.BufferGeometry {
  const half = n / 2;
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  let p = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      positions[p++] = i - half;
      positions[p++] = 0;
      positions[p++] = j - half;
    }
  }
  const indices: number[] = [];
  const row = n + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const cx = i + 0.5 - half;
      const cz = j + 0.5 - half;
      if (hole > 0 && Math.max(Math.abs(cx), Math.abs(cz)) < hole / 2) continue;
      const a = j * row + i;
      // wound so the top faces up (+y)
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

export interface SeaMesh {
  group: THREE.Group;
  /** Re-centre every level under the camera. */
  follow(camera: THREE.Camera): void;
  dispose(): void;
}

/** Concentric clip-map levels around the camera, finest first, all drawn with `material`. */
export function createSeaMesh(q: Quality, material: THREE.Material): SeaMesh {
  const count = levelCount(q);
  const inner = gridGeometry(q.grid);
  const ring = gridGeometry(q.grid, holeCells(q));
  const group = new THREE.Group();
  const levels: { mesh: THREE.Mesh; cell: number }[] = [];
  for (let i = 0; i < count; i++) {
    const cell = levelCell(q, i);
    const mesh = new THREE.Mesh(i === 0 ? inner : ring, material);
    mesh.scale.set(cell, 1, cell);
    mesh.frustumCulled = false; // vertices are displaced in the shader
    mesh.renderOrder = -(i + 1); // coarse levels first: the finer level wins where the two overlap
    group.add(mesh);
    levels.push({ mesh, cell });
  }
  return {
    group,
    follow(camera): void {
      for (const l of levels) l.mesh.position.set(snap(camera.position.x, l.cell), 0, snap(camera.position.z, l.cell));
    },
    dispose(): void {
      inner.dispose();
      ring.dispose();
    },
  };
}
