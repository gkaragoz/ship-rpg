import * as THREE from 'three';

export type Kind = 'smoke' | 'flash' | 'splash' | 'debris' | 'cloth' | 'flame' | 'spark' | 'dust';

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
const POOL = 520;

/** Flame sprites per second at full fire intensity (smoke is emitted at a fraction of it). */
const MAX_FLAME_RATE = 36;
const SMOKE_RATIO = 0.6;
/** Upper bound on particles one `burn` call may emit, so a long frame or many fires cannot flood the ring. */
export const MAX_BURN_EMIT = 4;

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

/** Flame particles per second for a fire intensity 0..1: 0 at 0, rising, capped at `MAX_FLAME_RATE`. */
export function burnRate(intensity: number): number {
  const i = clamp01(intensity);
  return i === 0 ? 0 : MAX_FLAME_RATE * (0.15 + 0.85 * i);
}

/** Carries fractional emissions between frames so the average rate is frame-rate independent. */
export interface EmitAccumulator {
  carry: number;
}

/** Whole particles to emit now for `rate` per second over `dt`; the fraction stays in `acc`. Capped at `maxPerCall` (excess is dropped, not queued). */
export function emitAccumulator(acc: EmitAccumulator, rate: number, dt: number, maxPerCall: number = MAX_BURN_EMIT): number {
  if (!(rate > 0) || !(dt > 0)) return 0;
  acc.carry += rate * dt;
  const whole = Math.floor(acc.carry);
  acc.carry -= whole;
  return Math.min(whole, maxPerCall);
}

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

/** How one sprite particle looks and moves. */
export interface EmitOptions {
  color: number;
  life: number;
  start: number;
  end: number;
  vx?: number;
  vy?: number;
  vz?: number;
  gravity?: number;
  opacity?: number;
}

export interface Effects {
  group: THREE.Group;
  /** One sprite particle (the impact effects in `impacts.ts` are made of these). */
  emit(kind: Kind, x: number, y: number, z: number, o: EmitOptions): void;
  /** Call every frame for each burning ship: `intensity` 0..1 at a point on its deck. Emits flames and smoke at a dt-independent rate. */
  burn(x: number, y: number, z: number, intensity: number, dt: number): void;
  /** Call every frame for a ship ploughing through the sea: spray flung up and aside at its bow, `intensity` 0..1, heading along (dirX, dirZ). */
  spray(x: number, y: number, z: number, dirX: number, dirZ: number, intensity: number, dt: number): void;
  /** Share of the smoke, spray, debris and flame particles drawn (0.25 … 1): the particles setting. */
  setDensity(share: number): void;
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
  let density = 1;
  const flameAcc: EmitAccumulator = { carry: 0 };
  const smokeAcc: EmitAccumulator = { carry: 0 };
  const sprayAcc: EmitAccumulator = { carry: 0 };

  const emit = (kind: Kind, x: number, y: number, z: number, o: EmitOptions): void => {
    if (density < 1 && kind !== 'flash' && Math.random() > density) return; // thin the particles out; muzzle flashes always show
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
    (p.sprite.material as THREE.SpriteMaterial).blending = kind === 'flame' || kind === 'spark' ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.sprite.visible = true;
  };

  const jitter = (n: number): number => (Math.random() - 0.5) * n;

  return {
    group,
    setDensity(share): void {
      density = Math.min(Math.max(share, 0.25), 1);
    },
    emit,
    burn(x, y, z, intensity, dt): void {
      const rate = burnRate(intensity);
      if (rate === 0) return;
      for (let n = emitAccumulator(flameAcc, rate, dt); n > 0; n--) {
        emit('flame', x + jitter(2.5), y + Math.random(), z + jitter(2.5), {
          color: Math.random() < 0.5 ? 0xff8a1f : 0xffd23c, life: 0.35 + Math.random() * 0.3, start: 2.2 + clamp01(intensity), end: 0.5,
          vx: jitter(1), vy: 5 + Math.random() * 3, vz: jitter(1), opacity: 0.9,
        });
      }
      for (let n = emitAccumulator(smokeAcc, rate * SMOKE_RATIO, dt); n > 0; n--) {
        emit('smoke', x + jitter(2), y + 1.5, z + jitter(2), {
          color: 0x3a3a3a, life: 2.2 + Math.random(), start: 2, end: 7, vx: jitter(1.5) + 0.8, vy: 3 + Math.random() * 2, vz: jitter(1.5), opacity: 0.6,
        });
      }
    },
    spray(x, y, z, dirX, dirZ, intensity, dt): void {
      const i = clamp01(intensity);
      if (i < 0.05) return;
      for (let n = emitAccumulator(sprayAcc, 70 * i, dt); n > 0; n--) {
        emit('splash', x + jitter(1.2), y, z + jitter(1.2), {
          color: 0xf4fbff, life: 0.6 + Math.random() * 0.4, start: 0.5 + i * 0.5, end: 1.4 + i, vx: -dirX * 2 + jitter(4), vy: 2.5 + Math.random() * (2 + 3 * i), vz: -dirZ * 2 + jitter(4), gravity: 9, opacity: 0.5,
        });
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
        (p.sprite.material as THREE.SpriteMaterial).opacity = p.opacity * (1 - t) ** (p.kind === 'flash' || p.kind === 'flame' || p.kind === 'spark' ? 1 : 1.5);
      }
    },
    dispose(): void {
      for (const p of pool) p.sprite.material.dispose();
      texture.dispose();
    },
  };
}
