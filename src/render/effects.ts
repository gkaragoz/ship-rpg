import * as THREE from 'three';
import type { GameEvent } from '../core';

type Kind = 'smoke' | 'flash' | 'splash' | 'debris';

interface Particle {
  sprite: THREE.Sprite;
  kind: Kind;
  age: number;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  start: number;
  end: number;
  gravity: number;
  opacity: number;
}

/** A ring: when full, the oldest particle is recycled (heavy volleys may cut short some smoke). */
const POOL = 192;

function softTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

export interface Effects {
  group: THREE.Group;
  /** Turn game events (muzzle fire, splashes, hits, sinking) into particles. */
  spawn(events: readonly GameEvent[]): void;
  update(dt: number): void;
  dispose(): void;
}

/** A small pooled sprite particle system: smoke, flashes, splashes, debris. */
export function createEffects(): Effects {
  const group = new THREE.Group();
  group.name = 'effects';
  const texture = softTexture();
  const pool: Particle[] = [];
  for (let i = 0; i < POOL; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.visible = false;
    group.add(sprite);
    pool.push({ sprite, kind: 'smoke', age: 1, life: 1, vx: 0, vy: 0, vz: 0, start: 1, end: 1, gravity: 0, opacity: 1 });
  }
  let next = 0;

  const emit = (
    kind: Kind,
    x: number,
    y: number,
    z: number,
    o: { color: number; life: number; start: number; end: number; vx?: number; vy?: number; vz?: number; gravity?: number; opacity?: number },
  ): void => {
    const p = pool[next]!;
    next = (next + 1) % POOL;
    p.kind = kind;
    p.age = 0;
    p.life = o.life;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.vz = o.vz ?? 0;
    p.start = o.start;
    p.end = o.end;
    p.gravity = o.gravity ?? 0;
    p.opacity = o.opacity ?? 1;
    p.sprite.position.set(x, y, z);
    (p.sprite.material as THREE.SpriteMaterial).color.setHex(o.color);
    p.sprite.scale.set(o.start, o.start, 1);
    p.sprite.visible = true;
  };

  const jitter = (n: number): number => (Math.random() - 0.5) * n;

  return {
    group,
    spawn(events): void {
      for (const e of events) {
        if (e.type === 'fire') {
          emit('flash', e.x, e.y, e.z, { color: 0xffc766, life: 0.12, start: 3, end: 5 });
          for (let i = 0; i < 3; i++) {
            emit('smoke', e.x + jitter(1), e.y + 0.5, e.z + jitter(1), {
              color: 0xdedede, life: 2.2, start: 2, end: 9, vx: jitter(2), vy: 1 + Math.random(), vz: jitter(2), opacity: 0.7,
            });
          }
        } else if (e.type === 'splash') {
          for (let i = 0; i < 4; i++) {
            emit('splash', e.x + jitter(1.5), 0.3, e.z + jitter(1.5), {
              color: 0xf4fbff, life: 1.1, start: 1.6, end: 3.2, vx: jitter(2), vy: 5 + Math.random() * 3, vz: jitter(2), gravity: 11, opacity: 0.85,
            });
          }
        } else if (e.type === 'hit') {
          emit('flash', e.x, e.y, e.z, { color: 0xff8a3c, life: 0.3, start: 3, end: 6 });
          for (let i = 0; i < 5; i++) {
            emit('debris', e.x, e.y, e.z, {
              color: 0x6b4a2b, life: 0.9, start: 0.7, end: 0.5, vx: jitter(9), vy: 3 + Math.random() * 6, vz: jitter(9), gravity: 14,
            });
          }
        } else {
          for (let i = 0; i < 10; i++) {
            emit('smoke', e.x + jitter(8), 3 + i * 1.5, e.z + jitter(8), {
              color: 0x555555, life: 4.5, start: 6, end: 22, vx: jitter(2), vy: 2 + Math.random() * 2, vz: jitter(2), opacity: 0.8,
            });
          }
        }
      }
    },
    update(dt): void {
      for (const p of pool) {
        if (!p.sprite.visible) continue;
        p.age += dt;
        if (p.age >= p.life) {
          p.sprite.visible = false;
          continue;
        }
        const t = p.age / p.life;
        p.vy -= p.gravity * dt;
        p.sprite.position.x += p.vx * dt;
        p.sprite.position.y += p.vy * dt;
        p.sprite.position.z += p.vz * dt;
        const size = p.start + (p.end - p.start) * t;
        p.sprite.scale.set(size, size, 1);
        (p.sprite.material as THREE.SpriteMaterial).opacity = p.opacity * (1 - t) ** (p.kind === 'flash' ? 1 : 1.5);
      }
    },
    dispose(): void {
      for (const p of pool) p.sprite.material.dispose();
      texture.dispose();
    },
  };
}
