import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createEnvironment } from './environment';
import { createPipeline } from './pipeline';
import { QUALITIES } from './quality';
import type { GraphicsSettings } from '../settings';
import { rideWaves } from './ride';
import { shipStamps, type Stamp } from './wakeStamps';
import { WORLD_BOUNDS, seaAmp } from '../world';

export interface GalleryView {
  /** Show one object centred and framed; null clears the stage. */
  setSubject(subject: THREE.Object3D | null): void;
  setAutoRotate(on: boolean): void;
  /** Camera orbit and zoom speed, 1 is the default. */
  setCameraSensitivity(factor: number): void;
  /** Apply the graphics settings: the same as at sea. */
  setGraphics(graphics: GraphicsSettings): void;
  update(dt: number): void;
  render(): void;
  dispose(): void;
}

/** The gallery's weather: a fresh breeze from the north and a light sea, so the ship rides gentle waves. */
const GALLERY_WIND_FROM = Math.PI / 2;
const GALLERY_SEA = 0.18;

/**
 * Where the gallery's ship floats: open water beyond the archipelago's corner (the sea shader's depth map is clamped at the
 * world's edge, and its corner is deep), so there is no shore foam or lagoon green around it.
 */
const GALLERY_CENTER = { x: WORLD_BOUNDS.minX - 3000, z: WORLD_BOUNDS.minZ - 3000 };

/** Screen areas (px) covered by UI; the subject is framed in the remaining space. */
export interface Insets {
  left: number;
  top: number;
  bottom: number;
}

/** Orbit-camera stage in the same sea and sky as the sailing view, with a ship riding the waves. */
export function createGalleryView(host: HTMLElement, getInsets: () => Insets, graphics: GraphicsSettings): GalleryView {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  let preset = QUALITIES[graphics.water];
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const env = createEnvironment(renderer, scene, preset);

  const pivot = new THREE.Group();
  pivot.position.set(GALLERY_CENTER.x, 0, GALLERY_CENTER.z);
  scene.add(pivot);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  controls.minDistance = 5;
  controls.maxDistance = 400;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;

  const clampInsets = (w: number, h: number): Insets => {
    const i = getInsets();
    return { left: Math.min(i.left, w * 0.4), top: Math.min(i.top, h * 0.3), bottom: Math.min(i.bottom, h * 0.45) };
  };
  const pipeline = createPipeline(renderer, scene, camera, graphics);
  const resize = (): void => {
    const w = Math.max(host.clientWidth, 1);
    const h = Math.max(host.clientHeight, 1);
    pipeline.setSize(w, h);
    camera.aspect = w / h;
    // Shift the image so the free area, not the whole canvas, is centred.
    const { left, top, bottom } = clampInsets(w, h);
    camera.setViewOffset(w, h, -left / 2, (bottom - top) / 2, w, h);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  let subject: THREE.Object3D | null = null;
  let dims = { length: 12, beam: 4 };
  let elapsed = 0;
  let lastRender = performance.now();
  const stamps: Stamp[] = [];
  const rest = { x: GALLERY_CENTER.x, z: GALLERY_CENTER.z, heading: 0, roll: 0 };

  return {
    setSubject(next): void {
      if (subject) pivot.remove(subject);
      subject = next;
      if (!next) return;
      pivot.add(next);
      pivot.updateMatrixWorld(true); // the framing below measures the ship where it stands in the world
      resize(); // panels may have changed size since the last resize
      const box = new THREE.Box3().setFromObject(next);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      dims = { length: size.x, beam: size.z };
      // The canvas spans the whole host but the ship must fit the area left free by
      // the panels, so scale the visible extent by that free fraction.
      const w = Math.max(host.clientWidth, 1);
      const h = Math.max(host.clientHeight, 1);
      const { left, top, bottom } = clampInsets(w, h);
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const freeW = (w - left) / w;
      const freeH = (h - top - bottom) / h;
      const fitHeight = ((size.y + size.x * 0.25) * 1.02) / (2 * tanV * freeH);
      const fitLength = (size.x * 0.95 * 1.02) / (2 * tanV * (w / h) * freeW);
      const distance = Math.max(fitLength, fitHeight) + size.z * 0.5;
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(0.55, 0.28, 0.9).normalize().multiplyScalar(distance));
      controls.update();
    },
    setCameraSensitivity(factor): void {
      controls.rotateSpeed = factor;
      controls.zoomSpeed = factor;
    },
    setAutoRotate(on): void {
      controls.autoRotate = on;
    },
    setGraphics(next): void {
      pipeline.apply(next);
      if (QUALITIES[next.water] !== preset) {
        preset = QUALITIES[next.water];
        env.setQuality(preset);
      }
    },
    update(dt): void {
      elapsed += dt;
      // The ship floats on the waves of the sea it stands in.
      rideWaves(pivot, rest, dims, elapsed, GALLERY_WIND_FROM, seaAmp(GALLERY_SEA));
      controls.update();
    },
    render(): void {
      renderer.info.reset();
      const now = performance.now();
      const dt = Math.min((now - lastRender) / 1000, 0.1);
      lastRender = now;
      stamps.length = 0;
      if (subject) shipStamps({ x: GALLERY_CENTER.x, z: GALLERY_CENTER.z, heading: 0, speed: 0, length: dims.length, beam: dims.beam, sinking: -1 }, dt, GALLERY_SEA, stamps);
      env.update({ camera, time: elapsed, dt, windFrom: GALLERY_WIND_FROM, seaState: GALLERY_SEA, stamps });
      pipeline.render();
    },
    dispose(): void {
      observer.disconnect();
      controls.dispose();
      env.dispose();
      pipeline.dispose();
      renderer.dispose();
      renderer.forceContextLoss(); // release the WebGL context; browsers cap how many stay alive
      renderer.domElement.remove();
    },
  };
}
