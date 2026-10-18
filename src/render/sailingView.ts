import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GameView } from '../core';
import { clamp } from '../core';
import { HORIZON_COLOR, SUN_DIR, createOcean } from './ocean';
import { createSky } from './sky';
import { waveHeight } from './waves';

export interface ShipDims {
  length: number;
  beam: number;
}

export interface SailingView {
  /** Set the player's ship model (origin at the waterline, +x bow) and its size. */
  setPlayer(model: THREE.Object3D, dims: ShipDims): void;
  /** Place the ship and camera for this snapshot and render. */
  draw(view: GameView): void;
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Open-sea scene: waves, sky and a chase camera that follows the player's ship. */
export function createSailingView(host: HTMLElement): SailingView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON_COLOR, 250, 900);
  scene.add(new THREE.HemisphereLight(0xdcecf5, 0x2b4a5a, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(sun);

  const ocean = createOcean();
  const sky = createSky();
  scene.add(ocean.mesh, sky.mesh);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;

  const resize = (): void => {
    const w = Math.max(host.clientWidth, 1);
    const h = Math.max(host.clientHeight, 1);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  let model: THREE.Object3D | null = null;
  let dims: ShipDims = { length: 20, beam: 6 };
  let lastHeading: number | null = null;
  const lastPos = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YZX');
  const target = new THREE.Vector3();
  const offset = new THREE.Vector3();

  return {
    setPlayer(next, nextDims): void {
      if (model) scene.remove(model);
      model = next;
      dims = nextDims;
      scene.add(next);
      controls.minDistance = dims.length * 0.7;
      controls.maxDistance = dims.length * 8;
      lastHeading = null; // re-frame the camera on the next draw
    },

    draw(view): void {
      const { ship, wind, time } = view;
      const ampScale = clamp(0.6 + wind.speed / 16, 0.6, 1.4);

      if (model) {
        // Ride the waves: sample under the bow, stern and both sides.
        const c = Math.cos(ship.heading);
        const s = Math.sin(ship.heading);
        const hl = dims.length * 0.4;
        const hb = dims.beam * 0.5;
        const sample = (dx: number, dz: number): number =>
          waveHeight(ship.x + dx, ship.z + dz, time, wind.from, ampScale);
        const bow = sample(c * hl, -s * hl);
        const stern = sample(-c * hl, s * hl);
        // Starboard direction in world (x, z) is (sin ψ, cos ψ).
        const stbd = sample(s * hb, c * hb);
        const port = sample(-s * hb, -c * hb);
        const y = (bow + stern + stbd + port) / 4;
        const pitch = Math.atan2(bow - stern, 2 * hl);
        const waveRoll = Math.atan2(stbd - port, 2 * hb);
        euler.set(ship.roll + waveRoll * 0.6, ship.heading, pitch * 0.8);
        model.position.set(ship.x, y, ship.z);
        model.setRotationFromEuler(euler);
      }

      // Chase camera: carry the camera with the ship and swing it with the turns.
      target.set(ship.x, dims.length * 0.12, ship.z);
      if (lastHeading === null) {
        offset.set(-dims.length * 1.9, dims.length * 0.7, 0).applyAxisAngle(UP, ship.heading);
        camera.position.copy(target).add(offset);
      } else {
        camera.position.add(target.clone().sub(lastPos));
        offset.copy(camera.position).sub(target).applyAxisAngle(UP, ship.heading - lastHeading);
        camera.position.copy(target).add(offset);
      }
      lastHeading = ship.heading;
      lastPos.copy(target);
      controls.target.copy(target);
      controls.update();
      camera.position.y = Math.max(camera.position.y, 1.5);

      ocean.update(camera, time, wind.from, ampScale);
      sky.update(camera);
      renderer.render(scene, camera);
    },

    dispose(): void {
      observer.disconnect();
      controls.dispose();
      ocean.dispose();
      sky.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
