import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createEnvironment } from './environment';
import { createPipeline, type RenderStats } from './pipeline';
import { LAMP_LIGHTS, createLamps } from './lamps';
import { enableShadows } from './shadows';
import { QUALITIES } from './quality';
import type { GraphicsSettings } from '../settings';
import { rideWaves } from './ride';
import { shadowStamp, shipStamps, type Stamp } from './wakeStamps';
import { DEFAULT_CLOCK, WORLD_BOUNDS, hourAt, seaAmp, startHourFor, weatherAt, type ClockSettings, type Weather, type WeatherOverrides } from '../world';

export interface GalleryView {
  /** Show one object centred and framed; null clears the stage. */
  setSubject(subject: THREE.Object3D | null): void;
  setAutoRotate(on: boolean): void;
  /** The gallery's day: how long it lasts and whether it stands still (it starts at mid-morning). */
  setClock(dayMinutes: number, frozen: boolean): void;
  /** The weather of the gallery, and the weather simulator's way into it (`null` goes back to the gallery's own breeze). */
  weather(): Weather;
  setWeather(change: WeatherOverrides | null): void;
  /** The hour of the gallery's day now, and a way to set it. */
  hour(): number;
  setHour(hour: number): void;
  /** Camera orbit and zoom speed, 1 is the default. */
  setCameraSensitivity(factor: number): void;
  /** Apply the graphics settings: the same as at sea. */
  setGraphics(graphics: GraphicsSettings): void;
  stats(): RenderStats;
  update(dt: number): void;
  render(): void;
  dispose(): void;
}

/** The gallery's weather: a fresh breeze from the north and a light sea, so the ship rides gentle waves. */
const GALLERY_WEATHER: WeatherOverrides = { windFrom: Math.PI / 2, windSpeed: 7, seaState: 0.18, rain: 0, lightning: 0 };

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
  env.apply(graphics);

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
  let overrides: WeatherOverrides = { ...GALLERY_WEATHER };
  let flash = 0;
  let clock: ClockSettings = { ...DEFAULT_CLOCK, startHour: 10.5 };
  let lastRender = performance.now();
  const stamps: Stamp[] = [];
  const lamps = createLamps();
  lamps.setCount(LAMP_LIGHTS[graphics.lights]);
  const rest = { x: GALLERY_CENTER.x, z: GALLERY_CENTER.z, heading: 0, roll: 0 };

  return {
    setSubject(next): void {
      if (subject) pivot.remove(subject);
      subject = next;
      if (!next) return;
      pivot.add(next);
      enableShadows(next);
      lamps.register(next);
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
    weather: () => weatherAt(elapsed, overrides),
    setWeather(change): void {
      if (change === null) {
        overrides = { ...GALLERY_WEATHER };
        return;
      }
      const next: Record<string, unknown> = { ...overrides };
      for (const [key, value] of Object.entries(change)) {
        if (value === undefined) delete next[key];
        else if (key === 'tuning') next.tuning = { ...overrides.tuning, ...(value as object) };
        else next[key] = value;
      }
      overrides = next as WeatherOverrides;
    },
    hour: () => hourAt(elapsed, clock),
    setHour(hour): void {
      clock.startHour = startHourFor(hour, elapsed, clock);
    },
    setClock(dayMinutes, frozen): void {
      const now = hourAt(elapsed, clock);
      clock = { dayMinutes, frozen, startHour: clock.startHour };
      clock.startHour = startHourFor(now, elapsed, clock);
    },
    setGraphics(next): void {
      pipeline.apply(next);
      env.apply(next);
      lamps.setCount(LAMP_LIGHTS[next.lights]);
      if (QUALITIES[next.water] !== preset) {
        preset = QUALITIES[next.water];
        env.setQuality(preset);
      }
    },
    update(dt): void {
      elapsed += dt;
      // The ship floats on the waves of the sea it stands in.
      const w = weatherAt(elapsed, overrides);
      rideWaves(pivot, rest, dims, elapsed, w.windFrom, seaAmp(w.seaState), true, 0, w.tuning);
      controls.update();
    },
    render(): void {
      pipeline.beginFrame();
      const now = performance.now();
      const dt = Math.min((now - lastRender) / 1000, 0.1);
      lastRender = now;
      stamps.length = 0;
      const w = weatherAt(elapsed, overrides);
      if (w.lightning > 0 && Math.random() < w.lightning * dt * 0.15) flash = 1; // an occasional flash for the simulator
      flash = Math.max(0, flash - dt * 3.2);
      if (subject) {
        const m = { x: GALLERY_CENTER.x, z: GALLERY_CENTER.z, heading: 0, speed: 0, length: dims.length, beam: dims.beam, sinking: -1 };
        shipStamps(m, dt, w.seaState, stamps);
        const sun = env.sunShadow();
        if (sun) shadowStamp(m, sun, stamps);
      }
      env.update({
        camera, time: elapsed, dt, windFrom: w.windFrom, seaState: w.seaState, hour: hourAt(elapsed, clock), stamps,
        focus: { position: pivot.position, length: dims.length },
        tuning: w.tuning, cloud: w.cloud, fog: w.fog, rain: w.rain, flash: flash * (0.65 + 0.35 * Math.sin(flash * 34)),
      });
      lamps.update(env.look.lamps, subject ? [{ root: subject, length: dims.length }] : [], camera);
      pipeline.render();
      pipeline.endFrame();
    },
    stats: () => pipeline.stats(),
    dispose(): void {
      observer.disconnect();
      controls.dispose();
      lamps.dispose();
      env.dispose();
      pipeline.dispose();
      renderer.dispose();
      renderer.forceContextLoss(); // release the WebGL context; browsers cap how many stay alive
      renderer.domElement.remove();
    },
  };
}
