import * as THREE from 'three';
import { ISLANDS, PORTS, fbm, hash2, terrainHeight, type Island, type Port } from '../world';

const CELL = 6;
const SAND = new THREE.Color(0xe6d6a0);
const GRASS_LOW = new THREE.Color(0x6f9a3a);
const GRASS_HIGH = new THREE.Color(0x3f6e2c);
const ROCK = new THREE.Color(0x8b8478);

export interface Scenery {
  group: THREE.Group;
  dispose(): void;
}

function indexedGeometry(positions: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Land colour from height and noise: sand beach, two greens, bare rock on the peaks. */
function landColor(h: number, x: number, z: number, out: THREE.Color): THREE.Color {
  const n = fbm(x * 0.05, z * 0.05, 5, 3);
  if (h < 2.5) return out.copy(SAND).lerp(GRASS_LOW, Math.max(0, (h - 1.2) / 1.3));
  if (h > 38) return out.copy(ROCK).lerp(GRASS_HIGH, Math.max(0, 1 - (h - 38) / 14));
  return out.copy(GRASS_LOW).lerp(GRASS_HIGH, Math.min(1, h / 40 + (n - 0.5) * 0.6));
}

/** One low-poly terrain patch per island, sampled from the shared height function. */
function buildTerrain(island: Island): THREE.Mesh {
  const half = island.radius * 1.5;
  const n = Math.ceil((half * 2) / CELL);
  const side = n + 1;
  const positions: number[] = [];
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const x = island.x - half + i * CELL;
      const z = island.z - half + j * CELL;
      const h = terrainHeight(x, z);
      // Keep a little seabed under the waves so wave troughs never show a hole.
      positions.push(x, Math.max(h, -3), z);
      landColor(h, x, z, c);
      colors.push(c.r, c.g, c.b);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i;
      indices.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
    }
  }
  const geometry = indexedGeometry(positions, indices);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }),
  );
  mesh.name = `terrain-${island.id}`;
  return mesh;
}

/** Cone trees scattered on gentle, mid-height ground. */
function buildTrees(island: Island): THREE.InstancedMesh | null {
  const spots: [number, number, number, number][] = [];
  const step = 14;
  const half = island.radius * 1.4;
  for (let z = island.z - half; z < island.z + half; z += step) {
    for (let x = island.x - half; x < island.x + half; x += step) {
      const jx = x + (hash2(Math.floor(x), Math.floor(z), island.seed) - 0.5) * step;
      const jz = z + (hash2(Math.floor(z), Math.floor(x), island.seed + 1) - 0.5) * step;
      const h = terrainHeight(jx, jz);
      if (h < 3 || h > 32) continue;
      const slope = Math.abs(terrainHeight(jx + 3, jz) - h) + Math.abs(terrainHeight(jx, jz + 3) - h);
      if (slope > 5) continue;
      if (fbm(jx * 0.02, jz * 0.02, island.seed + 7, 2) < 0.38) continue; // clearings
      spots.push([jx, h, jz, 0.7 + hash2(Math.floor(jx), Math.floor(jz), 3) * 0.8]);
    }
  }
  if (spots.length === 0) return null;
  const geometry = new THREE.ConeGeometry(2.2, 8, 6);
  geometry.translate(0, 4, 0);
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x2f5a26, flatShading: true, roughness: 1 }),
    spots.length,
  );
  const o = new THREE.Object3D();
  const c = new THREE.Color();
  spots.forEach(([x, y, z, s], i) => {
    o.position.set(x, y - 0.3, z);
    o.scale.set(s, s, s);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    mesh.setColorAt(i, c.setHSL(0.27 + (s - 1) * 0.05, 0.45, 0.2 + s * 0.08));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = `trees-${island.id}`;
  return mesh;
}

/** A label sprite that reads from the sea. */
function labelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 44px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(8, 20, 30, 0.85)';
    ctx.strokeText(text, 256, 48);
    ctx.fillStyle = '#f3e3a8';
    ctx.fillText(text, 256, 48);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, fog: false, depthWrite: false }));
  sprite.scale.set(70, 13, 1);
  return sprite;
}

/** Houses, a pier, a flag and a name label for one port. */
function buildTown(port: Port): THREE.Group {
  const g = new THREE.Group();
  g.name = `town-${port.id}`;
  const dir = new THREE.Vector2(Math.cos(port.outward), Math.sin(port.outward));
  const side = new THREE.Vector2(-dir.y, dir.x);

  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.ConeGeometry(0.75, 0.6, 4);
  roofGeo.rotateY(Math.PI / 4);
  const walls = new THREE.InstancedMesh(wallGeo, new THREE.MeshStandardMaterial({ color: 0xe9dcc0, flatShading: true, roughness: 1 }), 16);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0xa4472f, flatShading: true, roughness: 1 }), 16);
  const o = new THREE.Object3D();
  const r = new THREE.Object3D();
  let count = 0;
  for (let k = 0; k < 40 && count < 16; k++) {
    const sx = (hash2(k, 1, port.id.length * 31) - 0.5) * 70;
    const back = hash2(k, 2, port.id.length * 31) * 55;
    const x = port.town.x + side.x * sx - dir.x * back;
    const z = port.town.z + side.y * sx - dir.y * back;
    const h = terrainHeight(x, z);
    if (h < 1.8 || h > 14) continue;
    const w = 5 + hash2(k, 3, 7) * 4;
    const d = 5 + hash2(k, 4, 7) * 3;
    const hh = 3 + hash2(k, 5, 7) * 1.5;
    const yaw = -port.outward + (hash2(k, 6, 7) - 0.5) * 0.3;
    o.position.set(x, h + hh / 2, z);
    o.rotation.set(0, yaw, 0);
    o.scale.set(w, hh, d);
    o.updateMatrix();
    walls.setMatrixAt(count, o.matrix);
    r.position.set(x, h + hh + 0.9, z);
    r.rotation.set(0, yaw, 0);
    r.scale.set(w * 1.15, 1.6, d * 1.15);
    r.updateMatrix();
    roofs.setMatrixAt(count, r.matrix);
    count++;
  }
  walls.count = count;
  roofs.count = count;
  walls.instanceMatrix.needsUpdate = true;
  roofs.instanceMatrix.needsUpdate = true;

  // Pier: a plank deck from the shore into the water in front of the town.
  const reach = Math.hypot(port.anchor.x - port.coast.x, port.anchor.z - port.coast.z) * 0.45;
  const pier = new THREE.Mesh(
    new THREE.BoxGeometry(reach + 20, 0.5, 3.2),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2b, flatShading: true, roughness: 1 }),
  );
  pier.position.set(port.coast.x + dir.x * (reach / 2 - 10), 1.2, port.coast.z + dir.y * (reach / 2 - 10));
  pier.rotation.y = -port.outward;

  const topH = terrainHeight(port.town.x, port.town.z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 14, 5), new THREE.MeshStandardMaterial({ color: 0x4a3321 }));
  pole.position.set(port.town.x, topH + 7, port.town.z);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 3),
    new THREE.MeshBasicMaterial({ color: 0xc0392b, side: THREE.DoubleSide }),
  );
  flag.position.set(port.town.x + 2.5, topH + 12, port.town.z);

  const label = labelSprite(port.name);
  label.position.set(port.town.x, topH + 34, port.town.z);

  g.add(walls, roofs, pier, pole, flag, label);
  return g;
}

/** All islands, trees and port towns. Built once; `dispose()` frees everything. */
export function createScenery(): Scenery {
  const group = new THREE.Group();
  group.name = 'scenery';
  for (const island of ISLANDS) {
    group.add(buildTerrain(island));
    const trees = buildTrees(island);
    if (trees) group.add(trees);
  }
  for (const port of PORTS) group.add(buildTown(port));

  return {
    group,
    dispose(): void {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
          o.geometry.dispose();
          if (o instanceof THREE.InstancedMesh) o.dispose(); // instance matrix / colour buffers
          const m = o.material;
          for (const mat of Array.isArray(m) ? m : [m]) {
            if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshBasicMaterial) mat.dispose();
          }
        } else if (o instanceof THREE.Sprite) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
    },
  };
}
