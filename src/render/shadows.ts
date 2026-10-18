import * as THREE from 'three';
import type { GraphicsSettings, ShadowQuality } from '../settings';

/** Shadow map size and filter for each quality. */
export const SHADOW_PRESETS: Readonly<Record<Exclude<ShadowQuality, 'off'>, { size: number; type: THREE.ShadowMapType }>> = {
  low: { size: 1024, type: THREE.BasicShadowMap },
  medium: { size: 2048, type: THREE.PCFShadowMap },
  high: { size: 4096, type: THREE.PCFSoftShadowMap },
};

/** Half the side (m) of the area around the target that the sun's shadows cover, for a ship of this length. */
export function shadowRadius(shipLength: number, distance: number): number {
  return Math.min(Math.max(shipLength * 2.2, 40), 220) * distance;
}

/**
 * Snap `center` along the light's own axes to whole shadow-map texels: the map is then re-drawn on the same
 * texel grid every frame and edges do not crawl as the ship moves. `dir` points from the target towards the sun.
 */
export function snapToTexels(center: THREE.Vector3, dir: THREE.Vector3, texel: number, out = new THREE.Vector3()): THREE.Vector3 {
  const forward = dir.clone().normalize().negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const r = Math.round(center.dot(right) / texel) * texel;
  const u = Math.round(center.dot(up) / texel) * texel;
  const f = center.dot(forward);
  return out.set(0, 0, 0).addScaledVector(right, r).addScaledVector(up, u).addScaledVector(forward, f);
}

/** Mark a model's meshes as casting and receiving shadows (`castShadows` false: only receiving, for the terrain). */
export function enableShadows(root: THREE.Object3D, castShadows = true): void {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = castShadows;
      o.receiveShadow = true;
    }
  });
}

/**
 * The sun's shadows: one shadow map that follows a target (the player's ship), covering the ships near it.
 * Ships, crew and the terrain they sail past take part; the sea is a custom shader and gets its ship shadows from
 * the wake map instead (see `wakeStamps.ts`).
 */
export interface Shadows {
  readonly enabled: boolean;
  apply(graphics: GraphicsSettings): void;
  /** Aim the light along `towardSun` and keep the map on `target`; `radius` from `shadowRadius`. */
  update(target: THREE.Vector3, towardSun: THREE.Vector3, radius: number): void;
  dispose(): void;
}

export function createShadows(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sun: THREE.DirectionalLight): Shadows {
  let enabled = false;
  let size = 0;
  let type: THREE.ShadowMapType = THREE.PCFShadowMap;
  scene.add(sun.target);
  const snapped = new THREE.Vector3();

  const recompile = (): void => {
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
  };

  return {
    get enabled(): boolean {
      return enabled;
    },
    apply(g): void {
      const on = g.shadows !== 'off';
      const preset = on ? SHADOW_PRESETS[g.shadows as Exclude<ShadowQuality, 'off'>] : null;
      const changed = on !== enabled || (preset !== null && (preset.size !== size || preset.type !== type));
      enabled = on;
      renderer.shadowMap.enabled = on;
      sun.castShadow = on;
      if (!preset || !changed) return;
      if (preset.type !== type) {
        type = preset.type;
        renderer.shadowMap.type = type;
      }
      size = preset.size;
      sun.shadow.mapSize.set(size, size);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.06;
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      recompile();
    },
    update(target, towardSun, radius): void {
      if (!enabled) return;
      const texel = (2 * radius) / size;
      snapToTexels(target, towardSun, texel, snapped);
      const distance = radius * 3 + 120;
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(towardSun, distance);
      const cam = sun.shadow.camera;
      if (cam.right !== radius) {
        cam.left = -radius;
        cam.right = radius;
        cam.top = radius;
        cam.bottom = -radius;
        cam.near = 1;
        cam.far = distance + radius * 2;
        cam.updateProjectionMatrix();
      }
      sun.target.updateMatrixWorld();
    },
    dispose(): void {
      sun.castShadow = false;
      renderer.shadowMap.enabled = false;
      sun.shadow.map?.dispose();
      scene.remove(sun.target);
    },
  };
}
