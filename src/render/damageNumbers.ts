import * as THREE from 'three';
import type { GameEvent } from '../core';

export interface HitSum {
  owner: 'player' | 'enemy';
  x: number;
  y: number;
  z: number;
  amount: number;
}

/**
 * Merge the hits of one frame into one number per target: a broadside lands many balls
 * at once, and ten overlapping "-30" would be unreadable. Hits of the same owner within
 * `radius` metres of an existing sum are added to it.
 */
export function mergeHits(events: readonly GameEvent[], radius = 20): HitSum[] {
  const sums: HitSum[] = [];
  for (const e of events) {
    if (e.type !== 'hit' || !e.amount) continue;
    const near = sums.find((s) => s.owner === e.owner && Math.hypot(s.x - e.x, s.z - e.z) < radius);
    if (near) {
      const n = near.amount + e.amount;
      near.x = (near.x * near.amount + e.x * e.amount) / n;
      near.y = Math.max(near.y, e.y);
      near.z = (near.z * near.amount + e.z * e.amount) / n;
      near.amount = n;
    } else {
      sums.push({ owner: e.owner, x: e.x, y: e.y, z: e.z, amount: e.amount });
    }
  }
  return sums;
}

interface Floater {
  sprite: THREE.Sprite;
  age: number;
}

const LIFE = 1.4;
const POOL = 24;
/** Keeps a number readable at any distance: its world size grows with the distance to the camera. */
const SCREEN_SCALE = 0.05;

export interface DamageNumbers {
  group: THREE.Group;
  spawn(events: readonly GameEvent[]): void;
  update(dt: number, camera: THREE.Camera): void;
  dispose(): void;
}

/** Floating "-240" numbers: gold when we hit an enemy, red when we are hit. */
export function createDamageNumbers(): DamageNumbers {
  const group = new THREE.Group();
  group.name = 'damage-numbers';
  const textures = new Map<string, THREE.CanvasTexture>();
  const pool: Floater[] = [];
  for (let i = 0; i < POOL; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false }));
    sprite.visible = false;
    sprite.renderOrder = 10;
    sprite.layers.set(1); // sprites stay out of the occlusion pass (see pipeline.ts)
    group.add(sprite);
    pool.push({ sprite, age: LIFE });
  }
  let next = 0;

  const texture = (text: string, color: string): THREE.CanvasTexture => {
    const key = `${text}|${color}`;
    let t = textures.get(key);
    if (!t) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 96;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.font = 'bold 64px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 10;
        ctx.strokeStyle = 'rgba(10, 10, 10, 0.9)';
        ctx.strokeText(text, 128, 48);
        ctx.fillStyle = color;
        ctx.fillText(text, 128, 48);
      }
      t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      textures.set(key, t);
    }
    return t;
  };

  return {
    group,
    spawn(events): void {
      for (const h of mergeHits(events)) {
        const f = pool[next]!;
        next = (next + 1) % POOL;
        const mat = f.sprite.material;
        mat.map = texture(`-${Math.round(h.amount)}`, h.owner === 'player' ? '#ffd34d' : '#ff6a4d');
        mat.needsUpdate = true;
        mat.opacity = 1;
        f.sprite.position.set(h.x, h.y + 4, h.z);
        f.sprite.visible = true;
        f.age = 0;
      }
    },
    update(dt, camera): void {
      for (const f of pool) {
        if (!f.sprite.visible) continue;
        f.age += dt;
        if (f.age >= LIFE) {
          f.sprite.visible = false;
          continue;
        }
        f.sprite.position.y += 3.2 * dt;
        f.sprite.material.opacity = Math.min(1, (LIFE - f.age) / 0.5);
        const d = f.sprite.position.distanceTo(camera.position);
        const h = Math.max(2.2, d * SCREEN_SCALE);
        f.sprite.scale.set(h * (256 / 96), h, 1);
      }
    },
    dispose(): void {
      for (const f of pool) f.sprite.material.dispose();
      for (const t of textures.values()) t.dispose();
      textures.clear();
    },
  };
}
