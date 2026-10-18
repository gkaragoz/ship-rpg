import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GameView } from '../core';
import { CONFIG } from '../core';
import type { Ship, ShipLod } from '../ships';
import { createCrewRenderer } from './crew';
import { createFleet } from './fleet';
import { createEnvironment } from './environment';
import { LAMP_LIGHTS, createLamps } from './lamps';
import { createPipeline, excludeFromOcclusion, type RenderStats } from './pipeline';
import { enableShadows } from './shadows';
import { QUALITIES } from './quality';
import type { GraphicsSettings } from '../settings';
import { createAimArcs } from './aimArcs';
import { createDamageNumbers } from './damageNumbers';
import { createEffects } from './effects';
import { rideWaves } from './ride';
import { createScenery } from './scenery';
import { collectStamps, type Stamp } from './wakeStamps';
import { seaAmp } from '../world';

export interface ShipDims {
  length: number;
  beam: number;
}

/** Counters for performance checks (see `?perf` and the debug overlay). */
export interface ViewStats extends RenderStats {
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
  /** Apply the graphics settings (sea quality, antialiasing, render scale, tone mapping, bloom). */
  setGraphics(graphics: GraphicsSettings): void;
  /** Camera orbit and zoom speed, 1 is the default. */
  setCameraSensitivity(factor: number): void;
  /** Show another ship (an enemy) under `id`; the ids come from `GameView.enemies`. */
  addActor(id: string, model: THREE.Object3D, dims: ShipDims): void;
  removeActor(id: string): void;
  /** Place the ship and camera for this snapshot and render. */
  draw(view: GameView): void;
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Open-sea scene: waves, sky and a chase camera that follows the player's ship. */
export function createSailingView(host: HTMLElement, graphics: GraphicsSettings): SailingView {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }); // antialiasing is the pipeline's job
  let preset = QUALITIES[graphics.water];
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const env = createEnvironment(renderer, scene, preset);
  env.apply(graphics);

  const fleet = createFleet(scene);
  const crew = createCrewRenderer();
  const stamps: Stamp[] = [];
  const lamps = createLamps();
  lamps.setCount(LAMP_LIGHTS[graphics.lights]);
  let fleetShips: readonly Ship[] = [];
  let lastStrike = 0;
  let flash = 0;
  const scenery = createScenery();
  const effects = createEffects();
  const aim = createAimArcs();
  const numbers = createDamageNumbers();
  scene.add(scenery.group, aim.object, effects.group, numbers.group);
  for (const layer of [effects.group, aim.object, numbers.group]) excludeFromOcclusion(layer);
  enableShadows(scenery.group, false); // the terrain only receives: ships cast onto it in port

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

  const pipeline = createPipeline(renderer, scene, camera, graphics);
  const resize = (): void => {
    const w = Math.max(host.clientWidth, 1);
    const h = Math.max(host.clientHeight, 1);
    pipeline.setSize(w, h);
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
    st: { x: number; z: number; heading: number; roll: number; heave: number; pitch: number; waveRoll: number },
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
      enableShadows(next);
      lamps.register(next);
      crew?.attach(next);
      controls.minDistance = nextDims.length * 0.7;
      controls.maxDistance = nextDims.length * 14; // far enough out to survey the gun landing zones
      lastHeading = null; // re-frame the camera on the next draw
    },

    setOthers(ships): void {
      fleet.setShips(ships);
      fleetShips = ships;
      for (const s of ships) {
        enableShadows(s.root);
        lamps.register(s.root);
      }
    },
    setLodOverride: (lod) => fleet.setOverride(lod),

    stats: () => ({ ...pipeline.stats(), lods: fleet.lodCounts() }),

    setAimVisible(on): void {
      aim.setVisible(on);
    },

    setCameraSensitivity(factor): void {
      controls.rotateSpeed = factor;
      controls.zoomSpeed = factor;
    },

    setGraphics(next): void {
      pipeline.apply(next);
      env.apply(next);
      effects.setDensity(next.particles);
      lamps.setCount(LAMP_LIGHTS[next.lights]);
      if (QUALITIES[next.water] !== preset) {
        preset = QUALITIES[next.water];
        env.setQuality(preset);
      }
    },

    addActor(id, model, dims): void {
      const old = actors.get(id);
      if (old) scene.remove(old.model);
      actors.set(id, { model, dims });
      scene.add(model);
      enableShadows(model);
      lamps.register(model);
    },

    removeActor(id): void {
      const a = actors.get(id);
      if (a) scene.remove(a.model);
      actors.delete(id);
    },

    draw(view): void {
      pipeline.beginFrame(); // the counters and the GPU timer cover the whole frame, wake and post passes included
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
      // Ships throw spray from their bows, more in a rough sea.
      const spray = (st: { x: number; z: number; heading: number; speed: number; heave: number }, length: number): void => {
        const dx = Math.cos(st.heading);
        const dz = -Math.sin(st.heading);
        const power = Math.min(Math.abs(st.speed) / 8, 1) ** 1.5 * (0.25 + 0.9 * view.seaState);
        effects.spray(st.x + dx * length * 0.45, st.heave + 0.6, st.z + dz * length * 0.45, dx, dz, power, dt);
      };
      if (player && !view.sunk && !view.docked) spray(ship, player.dims.length);
      for (const e of view.enemies) {
        const a = actors.get(e.id);
        if (a && e.sinking < 0) spray(e, a.dims.length);
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

      // Ships and splashes paint foam and ripples into the wake map, which the sea then shows.
      collectStamps(view, dt, player?.dims ?? null, (id) => actors.get(id)?.dims ?? null, camera.position.x, camera.position.z, env.wake.size / 2, stamps, env.sunShadow());
      const focus = player ? { position: player.model.position, length: player.dims.length } : undefined;
      const hung = [
        ...(player ? [{ root: player.model, length: player.dims.length }] : []),
        ...[...actors.values()].map((a) => ({ root: a.model, length: a.dims.length })),
        ...fleetShips.map((s) => ({ root: s.root, length: s.spec.length })),
      ];
      // A new lightning strike flashes the sky for an instant (the thunder is the sound's business).
      const w = view.weather;
      if (w.strike && w.strike.id !== lastStrike) {
        lastStrike = w.strike.id;
        flash = 1;
      }
      flash = Math.max(0, flash - dt * 3.2);
      env.update({
        camera, time, dt, windFrom: wind.from, seaState: view.seaState, hour: view.hour, stamps, focus,
        tuning: w.tuning, cloud: w.cloud, fog: w.fog, rain: w.rain, flash: flash * (0.65 + 0.35 * Math.sin(flash * 34)),
      });
      lamps.update(env.look.lamps, hung, camera);
      fleet.update(view, camera, ampScale);
      crew?.update(view.crew, camera);
      shake = Math.max(0, shake - dt * 2.5);
      shakeOffset.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(shake * 1.6);
      camera.position.add(shakeOffset);
      try {
        pipeline.render();
      } finally {
        camera.position.sub(shakeOffset); // never leave the shake on the camera, even if drawing throws
      }
      pipeline.endFrame();
    },

    dispose(): void {
      observer.disconnect();
      fleet.dispose();
      crew?.dispose();
      controls.dispose();
      lamps.dispose();
      env.dispose();
      pipeline.dispose();
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
