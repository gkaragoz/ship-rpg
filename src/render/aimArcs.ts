import * as THREE from 'three';
import type { GameView } from '../core';
import { waveHeight } from './waves';

/** Grid resolution of each landing zone; vertices follow the waves so it never hides in a crest. */
const NX = 12;
const NZ = 4;
/** Lift above the long swell: clears the short waves the shader fades out with distance. */
const LIFT = 0.7;
/** Only waves at least this long are followed (see `waveHeight`). */
const SWELL = 50;

interface Side {
  sign: 1 | -1;
  positions: THREE.BufferAttribute;
  fill: THREE.MeshBasicMaterial;
  line: THREE.LineBasicMaterial;
  spoke: THREE.BufferAttribute;
  group: THREE.Group;
}

export interface AimArcs {
  object: THREE.Group;
  update(view: GameView, ampScale: number): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

/** Index list of the grid's outer edge, in order, for an outline loop. */
function perimeter(): number[] {
  const at = (i: number, j: number): number => j * (NX + 1) + i;
  const out: number[] = [];
  for (let i = 0; i <= NX; i++) out.push(at(i, 0));
  for (let j = 1; j <= NZ; j++) out.push(at(NX, j));
  for (let i = NX - 1; i >= 0; i--) out.push(at(i, NZ));
  for (let j = NZ - 1; j >= 1; j--) out.push(at(0, j));
  return out;
}

/**
 * Translucent landing zones on the sea beside the ship, one per broadside. They come
 * from the same ballistics the cannonballs use (`GameView.ship.aim`), so what they
 * show is where shots will fall: gold when loaded, dim while reloading.
 */
export function createAimArcs(): AimArcs {
  const object = new THREE.Group();
  object.name = 'aim-arcs';
  const verts = (NX + 1) * (NZ + 1);

  const index: number[] = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      index.push(a, a + NX + 1, a + 1, a + 1, a + NX + 1, a + NX + 2);
    }
  }
  const outline = perimeter();

  const make = (sign: 1 | -1): Side => {
    const positions = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', positions);
    fillGeo.setIndex(index);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', positions);
    lineGeo.setIndex(outline);

    const fill = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const line = new THREE.LineBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(fillGeo, fill);
    const loop = new THREE.LineLoop(lineGeo, line);
    for (const o of [mesh, loop]) o.frustumCulled = false;
    // A line from the hull out to the far edge, so the aim is visible near the ship too.
    const spoke = new THREE.BufferAttribute(new Float32Array(6), 3);
    spoke.setUsage(THREE.DynamicDrawUsage);
    const spokeGeo = new THREE.BufferGeometry();
    spokeGeo.setAttribute('position', spoke);
    const spokeLine = new THREE.Line(spokeGeo, line);
    spokeLine.frustumCulled = false;
    const group = new THREE.Group();
    group.add(mesh, loop, spokeLine);
    object.add(group);
    return { sign, positions, fill, line, spoke, group };
  };
  const sides = { port: make(-1), starboard: make(1) };

  let enabled = true;

  const fillSide = (
    side: Side,
    view: GameView,
    ampScale: number,
    loaded: boolean,
    inRange: boolean,
  ): void => {
    const { ship, wind, time } = view;
    const { near, far, halfSpan, drift } = ship.aim;
    const c = Math.cos(ship.heading);
    const s = Math.sin(ship.heading);
    const arr = side.positions.array as Float32Array;
    let k = 0;
    for (let j = 0; j <= NZ; j++) {
      const lz = side.sign * (near + ((far - near) * j) / NZ);
      for (let i = 0; i <= NX; i++) {
        const lx = drift - halfSpan + (2 * halfSpan * i) / NX;
        // Forward is (c, -s), starboard is (s, c).
        const x = ship.x + c * lx + s * lz;
        const z = ship.z - s * lx + c * lz;
        arr[k++] = x;
        arr[k++] = waveHeight(x, z, time, wind.from, ampScale, SWELL) + LIFT;
        arr[k++] = z;
      }
    }
    side.positions.needsUpdate = true;

    const sp = side.spoke.array as Float32Array;
    for (let e = 0; e < 2; e++) {
      const lz = side.sign * (e === 0 ? ship.aim.side : far);
      const x = ship.x + s * lz + c * drift;
      const z = ship.z + c * lz - s * drift;
      sp[e * 3] = x;
      sp[e * 3 + 1] = waveHeight(x, z, time, wind.from, ampScale, SWELL) + LIFT;
      sp[e * 3 + 2] = z;
    }
    side.spoke.needsUpdate = true;
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    // Gold when loaded, green when loaded and an enemy is in the zone, grey while reloading.
    const hot = loaded && inRange;
    side.fill.color.setHex(hot ? 0x6dff8f : loaded ? 0xffd34d : 0x9fb7c4);
    side.fill.opacity = hot ? 0.45 + 0.15 * pulse : loaded ? 0.32 + 0.14 * pulse : 0.1;
    side.line.color.setHex(hot ? 0xb8ffc8 : loaded ? 0xffe28a : 0x9fb7c4);
    side.line.opacity = loaded ? 0.95 : 0.3;
  };

  return {
    object,
    update(view, ampScale): void {
      const armed = view.ship.guns > 0 && !view.docked && !view.sunk;
      object.visible = enabled && armed;
      if (!object.visible) return;
      fillSide(sides.port, view, ampScale, view.ship.reload.port <= 0, view.ship.inRange.port);
      fillSide(sides.starboard, view, ampScale, view.ship.reload.starboard <= 0, view.ship.inRange.starboard);
    },
    setVisible(on): void {
      enabled = on;
    },
    dispose(): void {
      object.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineLoop || o instanceof THREE.Line) o.geometry.dispose();
      });
      for (const s of Object.values(sides)) {
        s.fill.dispose();
        s.line.dispose();
      }
    },
  };
}
