import * as THREE from 'three';

/**
 * Wreckage thrown from damaged ships: planks, splinters and torn sailcloth as real, tumbling 3D pieces (instanced).
 * They fly on a ballistic arc with drag and spin, then land on the sea, float with the swell for a while and sink.
 * The shapes are built here (no assets to load); `docs/SHIP_ASSETS.md` describes the Blender prop set that can replace them.
 */
export type DebrisKind = 'plank' | 'splinter' | 'cloth';

/** What one piece does when thrown. */
export interface Throw {
  kind: DebrisKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Size multiplier around 1, and spin in radians per second. */
  size?: number;
  spin?: number;
  /** Colour (a hex); defaults to a random weathered wood or cloth tone. */
  color?: number;
}

const CAPACITY: Readonly<Record<DebrisKind, number>> = { plank: 150, splinter: 150, cloth: 90 };
const GRAVITY = 9.81;
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Quaternion();
/** Seconds a piece floats before it sinks, and seconds it takes to go under. */
const FLOAT_SECONDS = 9;
const SINK_SECONDS = 2.5;

interface Piece {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  spin: THREE.Vector3;
  size: number;
  /** Seconds afloat; negative while in the air. */
  floatFor: number;
}

export interface Debris {
  group: THREE.Group;
  /** Throw a piece. The oldest of its kind is recycled when the pool is full. */
  launch(t: Throw): void;
  /** Share of the pieces made (0.25 … 1): the particles setting. */
  setDensity(share: number): void;
  readonly density: number;
  /** Advance by `dt`; `surface(x, z)` is the sea's height there. */
  update(dt: number, surface: (x: number, z: number) => number, windX: number, windZ: number): void;
  /** Pieces in flight or afloat (for the debug overlay and tests). */
  count(): number;
  dispose(): void;
}

/** A tiny deterministic random generator for the shapes (so they are the same every run). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A plank about a metre long: a box with a tapered, torn end. */
function plankGeometry(): THREE.BufferGeometry {
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
function splinterGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.0, 0.035, 0.55, 4, 1);
  g.rotateZ(Math.PI / 2);
  g.scale(1, 1, 0.6);
  return g;
}

/** A scrap of sailcloth: a crumpled plane. */
function clothGeometry(): THREE.BufferGeometry {
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

const WOOD = [0x6b4a2b, 0x7a5a36, 0x5a3d22, 0x8a6a42, 0x4a321c];
const CLOTH = [0xf1ead4, 0xe6dcc0, 0xd8cdb0];

export function createDebris(): Debris {
  const group = new THREE.Group();
  group.name = 'debris';
  const geometries: Record<DebrisKind, THREE.BufferGeometry> = { plank: plankGeometry(), splinter: splinterGeometry(), cloth: clothGeometry() };
  const materials: Record<DebrisKind, THREE.MeshStandardMaterial> = {
    plank: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, flatShading: true }),
    splinter: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true }),
    cloth: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
  };
  const meshes = {} as Record<DebrisKind, THREE.InstancedMesh>;
  const pieces = {} as Record<DebrisKind, Piece[]>;
  const cursor: Record<DebrisKind, number> = { plank: 0, splinter: 0, cloth: 0 };
  for (const kind of Object.keys(CAPACITY) as DebrisKind[]) {
    const mesh = new THREE.InstancedMesh(geometries[kind], materials[kind], CAPACITY[kind]);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY[kind] * 3), 3);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.name = `debris-${kind}`;
    group.add(mesh);
    meshes[kind] = mesh;
    pieces[kind] = Array.from({ length: CAPACITY[kind] }, () => ({
      alive: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      spin: new THREE.Vector3(),
      size: 1,
      floatFor: -1,
    }));
  }
  let density = 1;
  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const partial = new THREE.Quaternion();
  const dq = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const alive = { plank: 0, splinter: 0, cloth: 0 };

  return {
    group,
    get density(): number {
      return density;
    },
    setDensity(share): void {
      density = Math.min(Math.max(share, 0.25), 1);
    },
    launch(t): void {
      if (density < 1 && Math.random() > density) return;
      const list = pieces[t.kind];
      const i = cursor[t.kind];
      cursor[t.kind] = (i + 1) % list.length;
      const p = list[i]!;
      p.alive = true;
      p.pos.set(t.x, t.y, t.z);
      p.vel.set(t.vx, t.vy, t.vz);
      p.quat.setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
      const spin = t.spin ?? 7;
      p.spin.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
      p.size = (t.size ?? 1) * (0.7 + Math.random() * 0.6);
      p.floatFor = -1;
      const palette = t.kind === 'cloth' ? CLOTH : WOOD;
      color.setHex(t.color ?? palette[Math.floor(Math.random() * palette.length)]!);
      meshes[t.kind].setColorAt(i, color);
      if (meshes[t.kind].instanceColor) meshes[t.kind].instanceColor!.needsUpdate = true;
    },
    update(dt, surface, windX, windZ): void {
      for (const kind of Object.keys(CAPACITY) as DebrisKind[]) {
        const list = pieces[kind];
        const mesh = meshes[kind];
        let top = 0;
        let living = 0;
        for (let i = 0; i < list.length; i++) {
          const p = list[i]!;
          if (!p.alive) {
            // a dead slot still has to be a valid (degenerate) instance while it lies below the highest live one
            matrix.makeScale(0, 0, 0);
            mesh.setMatrixAt(i, matrix);
            continue;
          }
          const sea = surface(p.pos.x, p.pos.z);
          if (p.floatFor < 0) {
            // in the air: a little drag, gravity (cloth falls slowly), tumbling
            p.vel.multiplyScalar(Math.max(0, 1 - (kind === 'cloth' ? 2.4 : 0.35) * dt));
            p.vel.y -= GRAVITY * (kind === 'cloth' ? 0.45 : 1) * dt;
            p.pos.addScaledVector(p.vel, dt);
            axis.copy(p.spin);
            const w = axis.length();
            if (w > 1e-4) {
              dq.setFromAxisAngle(axis.multiplyScalar(1 / w), w * dt);
              p.quat.premultiply(dq).normalize();
            }
            if (p.pos.y <= sea) {
              p.floatFor = 0;
              p.vel.multiplyScalar(0.15);
              p.pos.y = sea;
            }
          } else {
            // afloat: ride the swell, drift with the wind, settle flat, then sink
            p.floatFor += dt;
            p.vel.x += (windX * 0.12 - p.vel.x) * Math.min(1, dt * 0.8);
            p.vel.z += (windZ * 0.12 - p.vel.z) * Math.min(1, dt * 0.8);
            p.pos.x += p.vel.x * dt;
            p.pos.z += p.vel.z * dt;
            const sink = Math.max(0, (p.floatFor - FLOAT_SECONDS) / SINK_SECONDS);
            p.pos.y = sea + 0.02 - sink * 0.7;
            // lie flat: turn the piece's own up axis towards the world's up, a little each frame
            axis.copy(UP).applyQuaternion(p.quat);
            dq.setFromUnitVectors(axis, UP);
            p.quat.premultiply(partial.copy(IDENTITY).slerp(dq, Math.min(1, dt * 2.5))).normalize();
            if (sink >= 1) {
              p.alive = false;
              continue;
            }
          }
          const sinkScale = p.floatFor > FLOAT_SECONDS ? Math.max(0, 1 - (p.floatFor - FLOAT_SECONDS) / SINK_SECONDS * 0.4) : 1;
          scale.setScalar(p.size * sinkScale);
          matrix.compose(p.pos, p.quat, scale);
          mesh.setMatrixAt(i, matrix);
          living++;
          top = i + 1;
        }
        alive[kind] = living;
        mesh.count = top;
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
    count: () => alive.plank + alive.splinter + alive.cloth,
    dispose(): void {
      for (const kind of Object.keys(CAPACITY) as DebrisKind[]) {
        meshes[kind].dispose();
        geometries[kind].dispose();
        materials[kind].dispose();
      }
    },
  };
}
