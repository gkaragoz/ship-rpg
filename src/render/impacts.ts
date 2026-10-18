import type * as THREE from 'three';
import type { GameEvent } from '../core';
import { createDebris } from './debris';
import type { Effects } from './effects';

/**
 * What the game's one-off events look like: the muzzle blast and its smoke jet, a ball striking a hull (sparks,
 * splinters, flying planks), tearing rigging (scraps of sailcloth), a column of water where a ball lands, the crunch of
 * two hulls meeting and the wreckage of a ship going down. Built from sprite particles (`effects.ts`) and 3D pieces (`debris.ts`).
 */
export interface Impacts {
  /** The 3D wreckage; add it to the scene. */
  readonly group: THREE.Group;
  spawn(events: readonly GameEvent[]): void;
  /** Share of the pieces thrown (0.25 … 1): the particles setting. */
  setDensity(share: number): void;
  /** Fly and float the wreckage; `surface(x, z)` is the sea height, (windX, windZ) the wind's push on what floats. */
  update(dt: number, surface: (x: number, z: number) => number, windX: number, windZ: number): void;
  dispose(): void;
}

const jitter = (n: number): number => (Math.random() - 0.5) * n;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const between = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

export function createImpacts(fx: Effects): Impacts {
  const debris = createDebris();
  /** Throw `n` pieces of `kind` from a point, away along (nx, nz) with a spread, `power` scaling speed and size. */
  const throwPieces = (kind: 'plank' | 'splinter' | 'cloth', n: number, x: number, y: number, z: number, nx: number, nz: number, power: number, spread = 1): void => {
    for (let i = 0; i < n; i++) {
      const out = between(3, 9) * power;
      debris.launch({
        kind,
        x: x + jitter(0.8),
        y: y + jitter(0.6),
        z: z + jitter(0.8),
        vx: nx * out + jitter(7) * spread,
        vy: between(2.5, 8) * Math.min(power, 1.4),
        vz: nz * out + jitter(7) * spread,
        size: kind === 'plank' ? between(0.5, 1.2) * Math.min(1.4, 0.7 + power * 0.4) : 1,
        spin: kind === 'cloth' ? 4 : 11,
      });
    }
  };

  const sparks = (n: number, x: number, y: number, z: number, nx: number, nz: number, power: number): void => {
    for (let i = 0; i < n; i++) {
      fx.emit('spark', x, y, z, {
        color: Math.random() < 0.5 ? 0xffd27a : 0xff9a3c,
        life: between(0.25, 0.6),
        start: between(0.25, 0.5),
        end: 0.05,
        vx: nx * between(3, 10) * power + jitter(9),
        vy: between(2, 9),
        vz: nz * between(3, 10) * power + jitter(9),
        gravity: 14,
      });
    }
  };

  const dust = (n: number, x: number, y: number, z: number, nx: number, nz: number, color: number, size: number): void => {
    for (let i = 0; i < n; i++) {
      fx.emit('dust', x + jitter(0.8), y + jitter(0.6), z + jitter(0.8), {
        color,
        life: between(0.9, 1.7),
        start: size * 0.5,
        end: size * between(1.6, 2.6),
        vx: nx * between(0.5, 3) + jitter(2.4),
        vy: between(0.4, 2),
        vz: nz * between(0.5, 3) + jitter(2.4),
        opacity: 0.5,
      });
    }
  };

  /** A column of water where a ball lands, with a ring of spray spreading over the surface. */
  const waterColumn = (x: number, y: number, z: number, power: number): void => {
    const n = Math.round(5 + 5 * power);
    for (let i = 0; i < n; i++) {
      fx.emit('splash', x + jitter(1.2), y + 0.2, z + jitter(1.2), {
        color: 0xf4fbff,
        life: between(0.9, 1.5),
        start: 1.2 * (0.7 + power * 0.5),
        end: 3.2 * (0.7 + power * 0.5),
        vx: jitter(2.2),
        vy: between(5, 9 + 5 * power),
        vz: jitter(2.2),
        gravity: 12,
        opacity: 0.85,
      });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + jitter(0.5);
      fx.emit('splash', x, y + 0.15, z, {
        color: 0xe6f4fa,
        life: 0.9,
        start: 1,
        end: 2.6,
        vx: Math.cos(a) * between(2.5, 4.5) * power,
        vy: between(0.3, 1.2),
        vz: Math.sin(a) * between(2.5, 4.5) * power,
        gravity: 2,
        opacity: 0.6,
      });
    }
  };

  return {
    group: debris.group,
    setDensity: (share) => debris.setDensity(share),
    update: (dt, surface, windX, windZ) => debris.update(dt, surface, windX, windZ),
    dispose: () => debris.dispose(),
    spawn(events): void {
      for (const e of events) {
        const nx = e.nx ?? 0;
        const nz = e.nz ?? 0;
        if (e.type === 'fire') {
          // one gun's blast (the guns of a broadside go off one after another): a flash, a jet of smoke along the barrel,
          // a few sparks, and a cloud that hangs behind
          fx.emit('flash', e.x + nx * 0.6, e.y, e.z + nz * 0.6, { color: 0xffc766, life: 0.12, start: 2.4, end: 4.5 });
          for (let i = 0; i < 2; i++) {
            fx.emit('smoke', e.x + nx * (1 + i * 0.7), e.y + 0.3, e.z + nz * (1 + i * 0.7), {
              color: 0xe8e8e8, life: between(1.6, 2.6), start: 1.2, end: 6 + i, vx: nx * between(5, 12) + jitter(2), vy: between(0.5, 1.8), vz: nz * between(5, 12) + jitter(2), opacity: 0.65,
            });
          }
          sparks(2, e.x + nx, e.y, e.z + nz, nx, nz, 1.2);
          fx.emit('smoke', e.x, e.y + 0.5, e.z, { color: 0xd6d6d6, life: 3.2, start: 2, end: 7, vx: jitter(1), vy: 1.2, vz: jitter(1), opacity: 0.55 });
        } else if (e.type === 'splash') {
          const power = clamp((e.speed ?? 70) / 90, 0.35, 1.2);
          if (e.y > 0.4) {
            // ball into the ground: a burst of earth and dust
            dust(8, e.x, e.y + 0.4, e.z, 0, 0, 0x8a7a5a, 2.4);
          } else {
            waterColumn(e.x, e.y, e.z, power);
          }
        } else if (e.type === 'hit') {
          const power = clamp(0.5 + (e.amount ?? 0) / 150, 0.5, 1.6);
          if (e.zone === 'rigging') {
            fx.emit('smoke', e.x, e.y, e.z, { color: 0xe8e2d0, life: 0.9, start: 1.5, end: 3.5, vy: 0.5, opacity: 0.6 });
            throwPieces('cloth', 5, e.x, e.y, e.z, nx, nz, 0.6, 0.5);
            throwPieces('splinter', 3, e.x, e.y, e.z, nx, nz, power);
            sparks(2, e.x, e.y, e.z, nx, nz, 0.6);
          } else if (e.zone === 'waterline') {
            fx.emit('flash', e.x, e.y, e.z, { color: 0x9a7a55, life: 0.25, start: 2.5, end: 4 });
            throwPieces('plank', Math.round(2 + 2 * power), e.x, e.y, e.z, nx, nz, power);
            throwPieces('splinter', 4, e.x, e.y, e.z, nx, nz, power);
            waterColumn(e.x + nx * 1.5, 0.2, e.z + nz * 1.5, 0.55 * power);
          } else {
            fx.emit('flash', e.x, e.y, e.z, { color: 0xff8a3c, life: 0.3, start: 3.5, end: 7 });
            sparks(Math.round(6 + 5 * power), e.x, e.y, e.z, nx, nz, power);
            throwPieces('plank', Math.round(3 + 4 * power), e.x, e.y, e.z, nx, nz, power);
            throwPieces('splinter', Math.round(5 + 4 * power), e.x, e.y, e.z, nx, nz, power);
            dust(5, e.x, e.y, e.z, nx, nz, 0x8a6a48, 1.8);
            fx.emit('smoke', e.x, e.y, e.z, { color: 0x4a4038, life: 1.4, start: 1.5, end: 5, vx: nx * 1.5, vy: 1.8, vz: nz * 1.5, opacity: 0.5 });
          }
        } else if (e.type === 'collision') {
          const power = clamp((e.speed ?? 3) / 5, 0.4, 2);
          fx.emit('flash', e.x, 1, e.z, { color: 0xffb066, life: 0.25, start: 3, end: 6 * power });
          throwPieces('plank', Math.round(4 + 6 * power), e.x, 1.2, e.z, nx, nz, 0.8 * power, 1.3);
          throwPieces('splinter', Math.round(6 + 6 * power), e.x, 1.2, e.z, nx, nz, power, 1.3);
          sparks(Math.round(5 * power), e.x, 1.2, e.z, nx, nz, power);
          dust(6, e.x, 1.2, e.z, nx, nz, 0x9a7a55, 2.6);
          waterColumn(e.x, 0.1, e.z, 0.5 * power);
        } else if (e.type === 'sunk') {
          for (let i = 0; i < 10; i++) {
            fx.emit('smoke', e.x + jitter(8), 3 + i * 1.5, e.z + jitter(8), {
              color: 0x555555, life: 4.5, start: 6, end: 22, vx: jitter(2), vy: 2 + Math.random() * 2, vz: jitter(2), opacity: 0.8,
            });
          }
          for (let i = 0; i < 22; i++) {
            const a = Math.random() * Math.PI * 2;
            debris.launch({
              kind: i % 3 === 0 ? 'splinter' : i % 5 === 0 ? 'cloth' : 'plank',
              x: e.x + jitter(10),
              y: 1.5 + Math.random() * 2,
              z: e.z + jitter(10),
              vx: Math.cos(a) * between(2, 9),
              vy: between(4, 11),
              vz: Math.sin(a) * between(2, 9),
              size: between(0.8, 1.6),
            });
          }
        }
      }
    },
  };
}
