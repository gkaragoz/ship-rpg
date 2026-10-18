import * as THREE from 'three';
import type { LightQuality } from '../settings';

/** How many ship lanterns light the night for real (point lights) at each light quality. */
export const LAMP_LIGHTS: Readonly<Record<LightQuality, number>> = { low: 0, medium: 2, high: 6 };

/** A ship the lamps can hang on: its model and length (m). */
export interface LampAnchor {
  root: THREE.Object3D;
  length: number;
}

/** The `count` anchors nearest to `from` (squared distances are enough), nearest first. */
export function nearestAnchors<T extends { root: THREE.Object3D }>(anchors: readonly T[], from: THREE.Vector3, count: number): T[] {
  const pos = new THREE.Vector3();
  return anchors
    .map((a) => ({ a, d: a.root.getWorldPosition(pos).distanceToSquared(from) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, count)
    .map((x) => x.a);
}

/** Materials that glow at night: stern windows and lanterns (the GLB glass, the procedural windows). */
const GLOWING = /glass|window|lantern/i;

type Glow = { kind: 'standard'; base: number } | { kind: 'basic'; base: THREE.Color };

/** Local position of a ship's stern lantern, as a fraction of its length. */
const LAMP_AT = { x: -0.44, y: 0.17 };

/**
 * Night lights: the lamps and windows of ships glow as it gets dark (`level` 0 day … 1 night), and the nearest
 * few ships carry a real warm point light that lights their decks and the water around them.
 */
export interface Lamps {
  /** Find a model's glowing materials (shared GLB materials are found once). */
  register(root: THREE.Object3D): void;
  /** How many point lights to keep (see `LAMP_LIGHTS`). */
  setCount(count: number): void;
  update(level: number, anchors: readonly LampAnchor[], camera: THREE.Camera): void;
  dispose(): void;
}

export function createLamps(): Lamps {
  const registry: { ref: WeakRef<THREE.Material>; glow: Glow }[] = [];
  const known = new WeakSet<THREE.Material>();
  const lights: THREE.PointLight[] = [];
  const position = new THREE.Vector3();

  const apply = (level: number): void => {
    for (let i = registry.length - 1; i >= 0; i--) {
      const entry = registry[i]!;
      const material = entry.ref.deref();
      if (!material) {
        registry.splice(i, 1); // a disposed ship's material
        continue;
      }
      const g = entry.glow;
      if (g.kind === 'standard') (material as THREE.MeshStandardMaterial).emissiveIntensity = g.base * (0.04 + 0.96 * level);
      else (material as THREE.MeshBasicMaterial).color.copy(g.base).multiplyScalar(0.35 + 0.65 * level);
    }
  };

  return {
    register(root): void {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (known.has(m) || !GLOWING.test(m.name)) continue;
          known.add(m);
          if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const s = m as THREE.MeshStandardMaterial;
            registry.push({ ref: new WeakRef(s), glow: { kind: 'standard', base: s.emissiveIntensity } });
          } else if ((m as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
            const b = m as THREE.MeshBasicMaterial;
            registry.push({ ref: new WeakRef(b), glow: { kind: 'basic', base: b.color.clone() } });
          }
        }
      });
    },
    setCount(count): void {
      while (lights.length > count) lights.pop()?.removeFromParent();
      while (lights.length < count) {
        const light = new THREE.PointLight(0xffb561, 0, 60, 1.6);
        lights.push(light);
      }
    },
    update(level, anchors, camera): void {
      apply(level);
      if (lights.length === 0) return;
      const chosen = nearestAnchors(anchors, camera.getWorldPosition(position), lights.length);
      lights.forEach((light, i) => {
        const a = chosen[i];
        if (!a) {
          light.intensity = 0;
          return;
        }
        if (light.parent !== a.root) a.root.add(light);
        light.position.set(LAMP_AT.x * a.length, LAMP_AT.y * a.length + 1.5, 0);
        light.distance = Math.max(40, a.length * 2.2);
        light.intensity = level * 14 * Math.min(Math.max(a.length / 20, 0.6), 2.2);
      });
    },
    dispose(): void {
      for (const l of lights) l.removeFromParent();
      lights.length = 0;
      registry.length = 0;
    },
  };
}
