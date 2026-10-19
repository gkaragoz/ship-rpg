import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const UP = new THREE.Vector3(0, 1, 0);

export interface ChaseCamera {
  /** Carry the camera with the ship and swing it with the turns (the player's orbit and zoom stay). */
  follow(ship: { x: number; z: number; heading: number }, length: number): void;
  /** The next `follow` frames the ship afresh (a new ship, a new run). */
  reset(): void;
}

/** The sailing camera: it travels with the ship and turns with it, while the orbit controls let the player look around. */
export function createChaseCamera(camera: THREE.PerspectiveCamera, controls: OrbitControls): ChaseCamera {
  let lastHeading: number | null = null;
  const lastPos = new THREE.Vector3();
  const target = new THREE.Vector3();
  const offset = new THREE.Vector3();
  return {
    follow(ship, length): void {
      target.set(ship.x, length * 0.12, ship.z);
      if (lastHeading === null) {
        offset.set(-length * 1.9, length * 0.7, 0).applyAxisAngle(UP, ship.heading);
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
    },
    reset(): void {
      lastHeading = null;
    },
  };
}
