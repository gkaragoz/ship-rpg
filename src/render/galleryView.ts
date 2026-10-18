import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface GalleryView {
  /** Show one object centred and framed; null clears the stage. */
  setSubject(subject: THREE.Object3D | null): void;
  setAutoRotate(on: boolean): void;
  /** Camera orbit and zoom speed, 1 is the default. */
  setCameraSensitivity(factor: number): void;
  update(dt: number): void;
  render(): void;
  dispose(): void;
}

const SKY = 0x9cc3d5;

/** Screen areas (px) covered by UI; the subject is framed in the remaining space. */
export interface Insets {
  left: number;
  top: number;
  bottom: number;
}

const NO_INSETS: Insets = { left: 0, top: 0, bottom: 0 };

/** Orbit-camera stage with sea, light and a gently bobbing subject. */
export function createGalleryView(host: HTMLElement, getInsets: () => Insets = () => NO_INSETS): GalleryView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 150, 900);
  scene.add(new THREE.HemisphereLight(0xdcecf5, 0x2b4a5a, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.set(-60, 90, 40);
  scene.add(sun);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({ color: 0x24607f, roughness: 0.9, flatShading: true }),
  );
  sea.rotation.x = -Math.PI / 2;
  scene.add(sea);

  const pivot = new THREE.Group();
  scene.add(pivot);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 3000);
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
  const resize = (): void => {
    const w = Math.max(host.clientWidth, 1);
    const h = Math.max(host.clientHeight, 1);
    renderer.setSize(w, h);
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
  let elapsed = 0;

  return {
    setSubject(next): void {
      if (subject) pivot.remove(subject);
      subject = next;
      if (!next) return;
      pivot.add(next);
      resize(); // panels may have changed size since the last resize
      const box = new THREE.Box3().setFromObject(next);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
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
    update(dt): void {
      elapsed += dt;
      pivot.position.y = Math.sin(elapsed * 1.2) * 0.08;
      pivot.rotation.z = Math.sin(elapsed * 0.9) * 0.012;
      controls.update();
    },
    render(): void {
      renderer.render(scene, camera);
    },
    dispose(): void {
      observer.disconnect();
      controls.dispose();
      sea.geometry.dispose();
      (sea.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.forceContextLoss(); // release the WebGL context; browsers cap how many stay alive
      renderer.domElement.remove();
    },
  };
}
