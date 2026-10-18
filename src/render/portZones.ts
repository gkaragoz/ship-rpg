import * as THREE from 'three';
import type { GameView } from '../core';
import { PORTS, portZoneCentre, portZoneCorners, type Port } from '../world';
import { waveHeight } from './waves';

/** Vertices per side of a zone's wave-following grid. */
const N = 8;
/** Lift above the long swell, as the aim zones do. */
const LIFT = 0.9;
const SWELL = 50;
/** Half the width of the border ribbon (m). */
const BORDER = 1.3;
/** Zones further than this from the ship are not updated (and not drawn). */
const SHOW_RANGE = 1800;
/** Height of the corner posts and of the anchor sign above the sea (m). */
const POST = 9;
const SIGN_HEIGHT = 20;
const SIGN_SIZE = 22;

/** The anchor sign: a gold anchor on a dark disc, drawn with paths so no font is needed. */
function anchorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(14,26,40,0.82)';
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(64, 32, 9, 0, Math.PI * 2); // ring
    ctx.moveTo(64, 41);
    ctx.lineTo(64, 98); // shank
    ctx.moveTo(46, 54);
    ctx.lineTo(82, 54); // stock
    ctx.moveTo(30, 74); // flukes
    ctx.quadraticCurveTo(36, 104, 64, 100);
    ctx.quadraticCurveTo(92, 104, 98, 74);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(24, 80);
    ctx.lineTo(32, 70);
    ctx.lineTo(40, 82);
    ctx.moveTo(88, 82);
    ctx.lineTo(96, 70);
    ctx.lineTo(104, 80);
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Zone {
  port: Port;
  group: THREE.Group;
  positions: THREE.BufferAttribute;
  ribbon: THREE.BufferAttribute;
  fill: THREE.MeshBasicMaterial;
  line: THREE.MeshBasicMaterial;
  postMat: THREE.LineBasicMaterial;
  posts: THREE.BufferAttribute;
  sign: THREE.Sprite;
  corners: { x: number; z: number }[];
  centre: { x: number; z: number };
}

export interface PortZones {
  object: THREE.Group;
  update(view: GameView, ampScale: number): void;
  dispose(): void;
}

/**
 * The marked entry zone of every port on the sea: a yellow rectangle that follows the waves, a post at each corner and
 * an anchor sign above it. It brightens when the ship is inside it and pulses once the ship is slow enough to enter.
 */
export function createPortZones(): PortZones {
  const object = new THREE.Group();
  object.name = 'port-zones';
  const texture = anchorTexture();
  const index: number[] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      index.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
    }
  }
  // The border is a ribbon (RIB points round the rectangle, each with an outer and an inner vertex), index of its quads.
  const RIB = N * 4;
  const ribIndex: number[] = [];
  for (let i = 0; i < RIB; i++) {
    const a = i * 2;
    const b = ((i + 1) % RIB) * 2;
    ribIndex.push(a, a + 1, b, b, a + 1, b + 1);
  }

  const zones: Zone[] = PORTS.map((port) => {
    const positions = new THREE.BufferAttribute(new Float32Array((N + 1) * (N + 1) * 3), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', positions);
    fillGeo.setIndex(index);
    const fill = new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending });
    const line = new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(fillGeo, fill);
    const ribbon = new THREE.BufferAttribute(new Float32Array(RIB * 2 * 3), 3);
    ribbon.setUsage(THREE.DynamicDrawUsage);
    const ribGeo = new THREE.BufferGeometry();
    ribGeo.setAttribute('position', ribbon);
    ribGeo.setIndex(ribIndex);
    const loop = new THREE.Mesh(ribGeo, line);
    const postMat = new THREE.LineBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    // a post at each corner: a vertical line from the sea up
    const posts = new THREE.BufferAttribute(new Float32Array(4 * 2 * 3), 3);
    posts.setUsage(THREE.DynamicDrawUsage);
    const postGeo = new THREE.BufferGeometry();
    postGeo.setAttribute('position', posts);
    const postLines = new THREE.LineSegments(postGeo, postMat);
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }));
    sign.scale.set(SIGN_SIZE, SIGN_SIZE, 1);
    const group = new THREE.Group();
    group.add(mesh, loop, postLines, sign);
    for (const o of [mesh, loop, postLines, sign]) o.frustumCulled = false;
    group.visible = false;
    object.add(group);
    return { port, group, positions, ribbon, fill, line, postMat, posts, sign, corners: portZoneCorners(port), centre: portZoneCentre(port) };
  });

  return {
    object,
    update(view, ampScale): void {
      const { ship, wind, time } = view;
      const tuning = view.weather.tuning;
      const pulse = 0.5 + 0.5 * Math.sin(time * 5);
      for (const z of zones) {
        const near = Math.hypot(z.port.anchor.x - ship.x, z.port.anchor.z - ship.z) < SHOW_RANGE && !view.docked;
        z.group.visible = near;
        if (!near) continue;
        const [c0, c1, c2, c3] = z.corners as [{ x: number; z: number }, { x: number; z: number }, { x: number; z: number }, { x: number; z: number }];
        const arr = z.positions.array as Float32Array;
        let k = 0;
        for (let j = 0; j <= N; j++) {
          for (let i = 0; i <= N; i++) {
            const s = i / N;
            const t = j / N;
            // bilinear over the corners (c0 → c1 along one side, c3 → c2 along the opposite one)
            const x = (c0.x * (1 - s) + c1.x * s) * (1 - t) + (c3.x * (1 - s) + c2.x * s) * t;
            const zz = (c0.z * (1 - s) + c1.z * s) * (1 - t) + (c3.z * (1 - s) + c2.z * s) * t;
            arr[k++] = x;
            arr[k++] = waveHeight(x, zz, time, wind.from, ampScale, SWELL, tuning) + LIFT;
            arr[k++] = zz;
          }
        }
        z.positions.needsUpdate = true;
        const rb = z.ribbon.array as Float32Array;
        for (let i = 0; i < RIB; i++) {
          const e = Math.floor(i / N);
          const f = (i % N) / N;
          const from = z.corners[e] as { x: number; z: number };
          const to = z.corners[(e + 1) % 4] as { x: number; z: number };
          const x = from.x + (to.x - from.x) * f;
          const zz = from.z + (to.z - from.z) * f;
          // outwards (away from the centre) and inwards by half the border width, bent at the corners
          let ox = x - z.centre.x;
          let oz = zz - z.centre.z;
          const len = Math.hypot(ox, oz) || 1;
          ox /= len;
          oz /= len;
          const x1 = x + ox * BORDER, z1 = zz + oz * BORDER, x2 = x - ox * BORDER, z2 = zz - oz * BORDER;
          rb.set([x1, waveHeight(x1, z1, time, wind.from, ampScale, SWELL, tuning) + LIFT, z1, x2, waveHeight(x2, z2, time, wind.from, ampScale, SWELL, tuning) + LIFT, z2], i * 6);
        }
        z.ribbon.needsUpdate = true;
        const pa = z.posts.array as Float32Array;
        z.corners.forEach((c, e) => {
          const y = waveHeight(c.x, c.z, time, wind.from, ampScale, SWELL, tuning) + LIFT;
          pa.set([c.x, y, c.z, c.x, y + POST, c.z], e * 6);
        });
        z.posts.needsUpdate = true;
        const mine = view.nearestPort?.id === z.port.id;
        const inside = mine && view.nearestPort?.inZone === true;
        const ready = mine && view.nearestPort?.dockable === true;
        z.fill.opacity = ready ? 0.07 + 0.07 * pulse : inside ? 0.06 : 0.03;
        z.line.opacity = inside ? 1 : 0.75;
        z.postMat.opacity = z.line.opacity;
        z.line.color.setHex(ready ? 0xffe27a : 0xffc83a);
        z.sign.position.set(z.centre.x, waveHeight(z.centre.x, z.centre.z, time, wind.from, ampScale, SWELL, tuning) + SIGN_HEIGHT, z.centre.z);
        (z.sign.material as THREE.SpriteMaterial).opacity = inside ? 1 : 0.8;
      }
    },
    dispose(): void {
      object.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
      });
      for (const z of zones) {
        z.fill.dispose();
        z.line.dispose();
        z.postMat.dispose();
        (z.sign.material as THREE.Material).dispose();
      }
      texture.dispose();
    },
  };
}
