import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GameView } from '../core';
import { CONFIG } from '../core';
import type { Ship, ShipLod } from '../ships';
import { createCrewRenderer } from './crew';
import { createFleet } from './fleet';
import { FOG_FAR, FOG_NEAR, HORIZON_COLOR, SUN_DIR, createOcean } from './ocean';
import { createAimArcs } from './aimArcs';
import { createDamageNumbers } from './damageNumbers';
import { createEffects } from './effects';
import { rideWaves } from './ride';
import { createScenery } from './scenery';
import { createSky } from './sky';
import { seaAmp } from '../world';

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

interface Actor {
  model: THREE.Object3D;
  dims: ShipDims;
}

/** Balls beyond this many in flight are not drawn: one enemy never gets near it (24 per volley, 6 s life). */
const MAX_BALLS = 256;

export interface SailingView {
  /** Set the player's ship model (origin at the waterline, +x bow) and its size. */
  setPlayer(model: THREE.Object3D, dims: ShipDims): void;
  /** Ambient ships; ship i draws `GameView.others[i]` and picks its own LOD by distance. */
  setOthers(ships: Ship[]): void;
  stats(): ViewStats;
  /** Debug: force the LOD of all ambient ships (null = by distance). */
  setLodOverride(lod: ShipLod | null): void;
  /** Show or hide the gun landing zones. */
  setAimVisible(on: boolean): void;
  /** Show another ship (an enemy) under `id`; the ids come from `GameView.enemies`. */
  addActor(id: string, model: THREE.Object3D, dims: ShipDims): void;
  removeActor(id: string): void;
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
  scene.fog = new THREE.Fog(HORIZON_COLOR, FOG_NEAR, FOG_FAR);
  scene.add(new THREE.HemisphereLight(0xdcecf5, 0x2b4a5a, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(sun);

  const fleet = createFleet(scene);
  const crew = createCrewRenderer();
  const ocean = createOcean();
  const sky = createSky();
  const scenery = createScenery();
  const effects = createEffects();
  const aim = createAimArcs();
  const numbers = createDamageNumbers();
  scene.add(ocean.object, sky.mesh, scenery.group, aim.object, effects.group, numbers.group);

  const ballMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.4, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.4 }),
    MAX_BALLS,
  );
  ballMesh.count = 0;
  ballMesh.frustumCulled = false;
  scene.add(ballMesh);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 6000);
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

  let player: Actor | null = null;
  const actors = new Map<string, Actor>();
  let shake = 0;
  const shakeOffset = new THREE.Vector3();
  let lastHeading: number | null = null;
  let lastClock = performance.now();
  const lastPos = new THREE.Vector3();
  const target = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const dummy = new THREE.Object3D();

  /** Put a ship on the waves under it, heeling with `roll` and sinking by `sinkTime` (−1 = afloat). */
  const place = (
    actor: Actor,
    st: { x: number; z: number; heading: number; roll: number },
    sinkTime: number,
    time: number,
    windFrom: number,
    ampScale: number,
  ): void => {
    const sink = sinkTime < 0 ? 0 : Math.min(sinkTime / CONFIG.sinkSeconds, 1);
    rideWaves(actor.model, st, actor.dims, time, windFrom, ampScale, true, sink);
  };

  return {
    setPlayer(next, nextDims): void {
      if (player) scene.remove(player.model);
      player = { model: next, dims: nextDims };
      scene.add(next);
      crew?.attach(next);
      controls.minDistance = nextDims.length * 0.7;
      controls.maxDistance = nextDims.length * 14; // far enough out to survey the gun landing zones
      lastHeading = null; // re-frame the camera on the next draw
    },

    setOthers: (ships) => fleet.setShips(ships),
    setLodOverride: (lod) => fleet.setOverride(lod),

    stats: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      lods: fleet.lodCounts(),
    }),

    setAimVisible(on): void {
      aim.setVisible(on);
    },

    addActor(id, model, dims): void {
      const old = actors.get(id);
      if (old) scene.remove(old.model);
      actors.set(id, { model, dims });
      scene.add(model);
    },

    removeActor(id): void {
      const a = actors.get(id);
      if (a) scene.remove(a.model);
      actors.delete(id);
    },

    draw(view): void {
      const { ship, wind, time } = view;
      const ampScale = seaAmp(view.seaState);
      const now = performance.now();
      const dt = Math.min((now - lastClock) / 1000, 0.1);
      lastClock = now;
      const dims = player?.dims ?? { length: 20, beam: 6 };

      if (player) place(player, ship, view.sunk ? view.sinkTime : -1, time, wind.from, ampScale);
      for (const e of view.enemies) {
        const a = actors.get(e.id);
        if (a) place(a, e, e.sinking, time, wind.from, ampScale);
      }
      // Burning ships smoke and flicker on their decks.
      if (player && ship.fire > 0 && !view.sunk) effects.burn(ship.x, player.dims.length * 0.1, ship.z, ship.fire, dt);
      for (const e of view.enemies) {
        const a = actors.get(e.id);
        if (a && e.fire > 0 && e.sinking < 0) effects.burn(e.x, a.dims.length * 0.1, e.z, e.fire, dt);
      }

      // Cannonballs as one instanced mesh.
      const n = Math.min(view.balls.length, MAX_BALLS);
      for (let i = 0; i < n; i++) {
        const b = view.balls[i]!;
        dummy.position.set(b.x, b.y, b.z);
        dummy.updateMatrix();
        ballMesh.setMatrixAt(i, dummy.matrix);
      }
      ballMesh.count = n;
      ballMesh.instanceMatrix.needsUpdate = true;
      aim.update(view, ampScale);
      effects.spawn(view.events);
      effects.update(dt);
      numbers.spawn(view.events);
      numbers.update(dt, camera);
      // Being hit shakes the camera; the offset is undone after drawing so it never drifts.
      for (const e of view.events) {
        if (e.type === 'hit' && e.owner === 'enemy') shake = Math.min(1.2, shake + 0.25 + (e.amount ?? 0) / 600);
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
      fleet.update(view, camera, ampScale);
      crew?.update(view.crew, camera);
      shake = Math.max(0, shake - dt * 2.5);
      shakeOffset.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(shake * 1.6);
      camera.position.add(shakeOffset);
      try {
        renderer.render(scene, camera);
      } finally {
        camera.position.sub(shakeOffset); // never leave the shake on the camera, even if drawing throws
      }
    },

    dispose(): void {
      observer.disconnect();
      fleet.dispose();
      crew?.dispose();
      controls.dispose();
      ocean.dispose();
      sky.dispose();
      scenery.dispose();
      effects.dispose();
      aim.dispose();
      numbers.dispose();
      ballMesh.geometry.dispose();
      (ballMesh.material as THREE.Material).dispose();
      ballMesh.dispose();
      renderer.dispose();
      renderer.forceContextLoss(); // release the WebGL context; browsers cap how many stay alive
      renderer.domElement.remove();
    },
  };
}
