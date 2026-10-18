import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAMP_LIGHTS, createLamps, nearestAnchors } from '../src/render/lamps';

const at = (x: number): { root: THREE.Object3D; length: number } => {
  const root = new THREE.Group();
  root.position.set(x, 0, 0);
  root.updateMatrixWorld(true);
  return { root, length: 20 };
};

describe('night lamps', () => {
  it('keeps more real lights at higher light quality', () => {
    expect(LAMP_LIGHTS.low).toBe(0);
    expect(LAMP_LIGHTS.medium).toBeLessThan(LAMP_LIGHTS.high);
  });

  it('picks the nearest ships, nearest first', () => {
    const ships = [at(300), at(10), at(-50), at(1000)];
    const picked = nearestAnchors(ships, new THREE.Vector3(0, 0, 0), 2);
    expect(picked).toEqual([ships[1], ships[2]]);
    expect(nearestAnchors(ships, new THREE.Vector3(), 10)).toHaveLength(4);
    expect(nearestAnchors([], new THREE.Vector3(), 2)).toEqual([]);
  });

  it('makes windows and glass glow as it gets dark, and leaves other materials alone', () => {
    const glass = new THREE.MeshStandardMaterial({ name: 'brig_glass', emissive: 0xffaa55, emissiveIntensity: 3 });
    const window = Object.assign(new THREE.MeshBasicMaterial({ color: 0xffd27a }), { name: 'window' });
    const hull = new THREE.MeshStandardMaterial({ name: 'brig_atlas_mat', emissiveIntensity: 1 });
    const root = new THREE.Group();
    for (const m of [glass, window, hull]) root.add(new THREE.Mesh(new THREE.BoxGeometry(), m));
    const lamps = createLamps();
    lamps.register(root);
    lamps.register(root); // registering twice must not stack
    const camera = new THREE.PerspectiveCamera();
    lamps.update(0, [], camera);
    expect(glass.emissiveIntensity).toBeLessThan(0.3);
    expect(window.color.r).toBeLessThan(0.5);
    lamps.update(1, [], camera);
    expect(glass.emissiveIntensity).toBeCloseTo(3);
    expect(window.color.getHex()).toBe(0xffd27a);
    expect(hull.emissiveIntensity).toBe(1);
    lamps.dispose();
  });

  it('hangs point lights on the nearest ships only at night', () => {
    const scene = new THREE.Scene();
    const ships = [at(5), at(500)];
    for (const s of ships) scene.add(s.root);
    const lamps = createLamps();
    lamps.setCount(1);
    const camera = new THREE.PerspectiveCamera();
    lamps.update(1, ships, camera);
    const lights = scene.children.flatMap((c) => c.children.filter((x) => (x as THREE.PointLight).isPointLight)) as THREE.PointLight[];
    expect(lights).toHaveLength(1);
    expect(ships[0]!.root.children).toContain(lights[0]);
    expect(lights[0]!.intensity).toBeGreaterThan(5);
    lamps.update(0, ships, camera);
    expect(lights[0]!.intensity).toBe(0);
    lamps.setCount(0);
    expect(ships[0]!.root.children).not.toContain(lights[0]);
  });
});
