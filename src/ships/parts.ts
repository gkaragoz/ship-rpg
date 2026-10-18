import * as THREE from 'three';

/** Index list for the two triangles of one quad in a station × segment grid. */
export function quadIndices(station: number, seg: number, ringSize: number): number[] {
  const a = station * ringSize + seg;
  const b = a + 1;
  const c = a + ringSize;
  const d = c + 1;
  return [a, c, b, b, c, d];
}

/** Geometry with one material group per index set. */
export function buildGroupedGeometry(positions: number[], indexSets: number[][]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const all: number[] = [];
  indexSets.forEach((set, i) => {
    geometry.addGroup(all.length, set.length, i);
    for (const idx of set) all.push(idx);
  });
  geometry.setIndex(all);
  geometry.computeVertexNormals();
  return geometry;
}

export function cylinderBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 6), material);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/**
 * Parametric sail surface: `at(u, v)` maps the unit square to space; the surface
 * billows along `bulgeDir` by up to `bulge` metres, zero on all edges.
 */
export function gridSail(
  at: (u: number, v: number) => THREE.Vector3,
  bulgeDir: THREE.Vector3,
  bulge: number,
  material: THREE.Material,
  seg = 8,
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= seg; i++) {
    for (let j = 0; j <= seg; j++) {
      const u = i / seg;
      const v = j / seg;
      const p = at(u, v).addScaledVector(bulgeDir, bulge * Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
      positions.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < seg; j++) indices.push(...quadIndices(i, j, seg + 1));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}
