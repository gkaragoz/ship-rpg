import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GameView } from '../core';
import { clamp } from '../core';
import type { Ship, ShipLod } from '../ships';
import { createCrewRenderer } from './crew';
import { createFleet } from './fleet';
import { HORIZON_COLOR, SUN_DIR, createOcean } from './ocean';
import { rideWaves } from './ride';
import { createSky } from './sky';

export interface ShipDims {
  length: number;
  beam: number;
}

/** Counters for performance checks (see `?perf` in the sailing mode). */
export interface ViewStats {
  calls: number;
  triangles: number;
  /** Other ships currently drawn at LOD 0, 1 and 2. */
  lods: [number, number, number];
}

export interface SailingView {
  /** Set the player's ship model (origin at the waterline, +x bow) and its size. */
  setPlayer(model: THREE.Object3D, dims: ShipDims): void;
  /** Other ships; ship i draws `GameView.others[i]` and picks its own LOD by distance. */
  setOthers(ships: Ship[]): void;
  stats(): ViewStats;
  /** Debug: force the LOD of all other ships (null = by distance). */
  setLodOverride(lod: ShipLod | null): void;
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

  const fleet = createFleet(scene);
  const crew = createCrewRenderer();
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
  const target = new THREE.Vector3();
  const offset = new THREE.Vector3();

  return {
    setPlayer(next, nextDims): void {
      if (model) scene.remove(model);
      model = next;
      dims = nextDims;
      scene.add(next);
      crew?.attach(next);
      controls.minDistance = dims.length * 0.7;
      controls.maxDistance = dims.length * 8;
      lastHeading = null; // re-frame the camera on the next draw
    },

    setOthers: (ships) => fleet.setShips(ships),
    setLodOverride: (lod) => fleet.setOverride(lod),

    stats: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      lods: fleet.lodCounts(),
    }),

    draw(view): void {
      const { ship, wind, time } = view;
      const ampScale = clamp(0.6 + wind.speed / 16, 0.6, 1.4);

      if (model) rideWaves(model, ship, dims, time, wind.from, ampScale);

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
      fleet.update(view, camera, ampScale);
      crew?.update(view.crew, camera);
      renderer.render(scene, camera);
    },

    dispose(): void {
      observer.disconnect();
      fleet.dispose();
      crew?.dispose();
      controls.dispose();
      ocean.dispose();
      sky.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
