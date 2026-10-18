import * as THREE from 'three';
import { CONFIG, type GameView } from '../core';
import { waveHeight } from './waves';

/** Grid resolution of each landing zone (vertices follow the waves so it never hides in a crest): columns along the hull, ... */
const NX = 12;
/** ... and one row per sample of the hit-chance profile, so the shading follows the chance of a hit. */
const NZ = CONFIG.aimSteps;
/** Lift above the long swell: clears the short waves the shader fades out with distance. */
const LIFT = 0.9;
/** Only waves at least this long are followed (see `waveHeight`). */
const SWELL = 50;

/** A soft round dot for the beads along the flight path. */
function dotTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(canvas);
}
/** Points of the flight path (see `arcFor` in gameplay: the muzzle and this many more). */
const ARC_POINTS = 37;

interface Side {
  sign: 1 | -1;
  positions: THREE.BufferAttribute;
  /** RGBA per vertex: white, with the alpha following the chance of a hit. */
  colors: THREE.BufferAttribute;
  fill: THREE.MeshBasicMaterial;
  line: THREE.LineBasicMaterial;
  spoke: THREE.BufferAttribute;
  /** The path a ball will fly (muzzle to landing) and the ring where it comes down. */
  arc: THREE.BufferAttribute;
  arcLine: THREE.LineBasicMaterial;
  arcDots: THREE.PointsMaterial;
  ring: THREE.Mesh;
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
  const dot = dotTexture();

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
    const colors = new THREE.BufferAttribute(new Float32Array(verts * 4), 4);
    colors.setUsage(THREE.DynamicDrawUsage);
    fillGeo.setAttribute('color', colors);
    fillGeo.setIndex(index);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', positions);
    lineGeo.setIndex(outline);

    const fill = new THREE.MeshBasicMaterial({ color: 0xffd34d, vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, fog: false });
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
    // The flight path of a ball, drawn as a line from the muzzle to the sea, and a ring where it lands.
    const arc = new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3);
    arc.setUsage(THREE.DynamicDrawUsage);
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', arc);
    const arcLine = new THREE.LineBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, fog: false });
    const arcMesh = new THREE.Line(arcGeo, arcLine);
    arcMesh.frustumCulled = false;
    arcMesh.renderOrder = 5;
    // beads along the path: they read from any angle where a one-pixel line would not
    const arcDots = new THREE.PointsMaterial({ color: 0xfff1b8, map: dot, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, fog: false });
    const beads = new THREE.Points(arcGeo, arcDots);
    beads.frustumCulled = false;
    beads.renderOrder = 6;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 28), new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 5;
    ring.frustumCulled = false;
    const group = new THREE.Group();
    group.add(mesh, loop, spokeLine, arcMesh, beads, ring);
    object.add(group);
    return { sign, positions, colors, fill, line, spoke, arc, arcLine, arcDots, ring, group };
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
    const tuning = view.weather.tuning;
    const { near, far, halfSpan, drift } = ship.aim;
    const c = Math.cos(ship.heading);
    const s = Math.sin(ship.heading);
    const arr = side.positions.array as Float32Array;
    const rgba = side.colors.array as Float32Array;
    let k = 0;
    let c4 = 0;
    for (let j = 0; j <= NZ; j++) {
      // Fainter where fewer balls would hit, so the zone shows where to put the target.
      const alpha = 0.12 + 0.88 * (ship.aim.profile[j] ?? 0);
      const lz = side.sign * (near + ((far - near) * j) / NZ);
      for (let i = 0; i <= NX; i++) {
        const lx = drift - halfSpan + (2 * halfSpan * i) / NX;
        // Forward is (c, -s), starboard is (s, c).
        const x = ship.x + c * lx + s * lz;
        const z = ship.z - s * lx + c * lz;
        arr[k++] = x;
        arr[k++] = waveHeight(x, z, time, wind.from, ampScale, SWELL, tuning) + LIFT;
        arr[k++] = z;
        rgba[c4++] = 1;
        rgba[c4++] = 1;
        rgba[c4++] = 1;
        rgba[c4++] = alpha;
      }
    }
    side.positions.needsUpdate = true;
    side.colors.needsUpdate = true;

    const sp = side.spoke.array as Float32Array;
    for (let e = 0; e < 2; e++) {
      const lz = side.sign * (e === 0 ? ship.aim.side : far);
      const x = ship.x + s * lz + c * drift;
      const z = ship.z + c * lz - s * drift;
      sp[e * 3] = x;
      sp[e * 3 + 1] = waveHeight(x, z, time, wind.from, ampScale, SWELL, tuning) + LIFT;
      sp[e * 3 + 2] = z;
    }
    side.spoke.needsUpdate = true;
    const path = ship.arc[side.sign === 1 ? 'starboard' : 'port'];
    const ap = side.arc.array as Float32Array;
    for (let i = 0; i < ARC_POINTS; i++) {
      const p = path[Math.min(i, path.length - 1)];
      if (!p) break;
      ap[i * 3] = p.x;
      ap[i * 3 + 1] = i === ARC_POINTS - 1 || i === path.length - 1 ? waveHeight(p.x, p.z, time, wind.from, ampScale, SWELL, tuning) + 0.3 : p.y;
      ap[i * 3 + 2] = p.z;
    }
    side.arc.needsUpdate = true;
    const landing = path[path.length - 1];
    if (landing) {
      side.ring.position.set(landing.x, waveHeight(landing.x, landing.z, time, wind.from, ampScale, SWELL, tuning) + 0.35, landing.z);
      side.ring.scale.setScalar(Math.max(2.5, ship.aim.spread * 0.5));
    }
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    // Gold when loaded, green when loaded and an enemy is in the zone, grey while reloading.
    const hot = loaded && inRange;
    side.fill.color.setHex(hot ? 0x6dff8f : loaded ? 0xffd34d : 0x9fb7c4);
    side.fill.opacity = hot ? 0.45 + 0.15 * pulse : loaded ? 0.32 + 0.14 * pulse : 0.1;
    side.line.color.setHex(hot ? 0xb8ffc8 : loaded ? 0xffe28a : 0x9fb7c4);
    side.line.opacity = loaded ? 0.95 : 0.3;
    const tint = hot ? 0xe4ffe9 : loaded ? 0xfff1b8 : 0xb9ccd6;
    side.arcLine.color.setHex(tint);
    side.arcLine.opacity = loaded ? 0.95 : 0.4;
    side.arcDots.color.setHex(tint);
    side.arcDots.opacity = loaded ? 0.95 : 0.4;
    const ringMat = side.ring.material as THREE.MeshBasicMaterial;
    ringMat.color.setHex(tint);
    ringMat.opacity = loaded ? 0.5 + 0.35 * pulse : 0.25;
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
      dot.dispose();
      for (const s of Object.values(sides)) {
        s.fill.dispose();
        s.line.dispose();
        s.arcLine.dispose();
        s.arcDots.dispose();
        s.ring.geometry.dispose();
        (s.ring.material as THREE.Material).dispose();
      }
    },
  };
}
