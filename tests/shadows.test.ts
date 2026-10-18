import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SHADOW_PRESETS, shadowRadius, snapToTexels } from '../src/render/shadows';
import { shadowStamp, type Stamp } from '../src/render/wakeStamps';
import { TEXTURE_QUALITY } from '../src/render/quality';

describe('shadow map placement', () => {
  it('covers more ground around a longer ship and for a longer shadow distance, within limits', () => {
    expect(shadowRadius(12, 1)).toBe(40);
    expect(shadowRadius(64, 1)).toBeCloseTo(140.8);
    expect(shadowRadius(500, 1)).toBe(220);
    expect(shadowRadius(64, 1.5)).toBeGreaterThan(shadowRadius(64, 1));
  });

  it('snaps the target to whole texels along the light axes, so the map does not crawl', () => {
    const toward = new THREE.Vector3(-0.5, 0.7, -0.4).normalize();
    const texel = 0.25;
    const forward = toward.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    for (const p of [new THREE.Vector3(12.34, 0, -7.77), new THREE.Vector3(-5000.1, 0, -4331.9)]) {
      const s = snapToTexels(p, toward, texel);
      expect(s.dot(right) / texel).toBeCloseTo(Math.round(s.dot(right) / texel), 5);
      expect(s.dot(up) / texel).toBeCloseTo(Math.round(s.dot(up) / texel), 5);
      expect(s.dot(forward)).toBeCloseTo(p.dot(forward), 5); // depth along the light is unchanged
      expect(s.distanceTo(p)).toBeLessThan(texel * 1.5); // and it never jumps more than a texel
    }
    // a small move of the ship moves the snapped point in whole-texel steps, not continuously
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const s = snapToTexels(new THREE.Vector3(1 + i * 0.01, 0, 1), toward, texel);
      seen.add(`${s.dot(right).toFixed(4)},${s.dot(up).toFixed(4)}`); // the depth along the light is free to follow
    }
    expect(seen.size).toBeLessThanOrEqual(4); // 0.2 m of travel is at most a texel step or two per axis, never 20 different positions
  });

  it('grows the map and the filter with the shadow quality', () => {
    expect(SHADOW_PRESETS.low.size).toBeLessThan(SHADOW_PRESETS.medium.size);
    expect(SHADOW_PRESETS.medium.size).toBeLessThan(SHADOW_PRESETS.high.size);
    expect(SHADOW_PRESETS.low.type).toBe(THREE.BasicShadowMap);
    expect(SHADOW_PRESETS.high.type).toBe(THREE.PCFSoftShadowMap);
  });
});

describe('ship shadows on the sea', () => {
  const ship = { x: 100, z: 50, heading: 0, speed: 0, length: 20, beam: 6, sinking: -1 };
  const cast = (elevation: number, dirX = 1, dirZ = 0): Stamp => {
    const out: Stamp[] = [];
    shadowStamp(ship, { dirX, dirZ, elevation, strength: 1 }, out);
    return out[0]!;
  };

  it('throws a longer shadow when the sun is lower, away from the sun, in the blue-channel kind', () => {
    const high = cast(1.2);
    const low = cast(0.3);
    expect(low.length).toBeGreaterThan(high.length);
    expect(low.kind).toBe(2);
    expect(low.x).toBeGreaterThan(ship.x); // the sun's light travels along +x: the shadow falls there
    expect(cast(0.5, 0, 1).z).toBeGreaterThan(ship.z);
  });

  it('casts none with the sun at the horizon or below, nor for a sinking ship', () => {
    const out: Stamp[] = [];
    shadowStamp(ship, { dirX: 1, dirZ: 0, elevation: 0.02, strength: 1 }, out);
    shadowStamp({ ...ship, sinking: 2 }, { dirX: 1, dirZ: 0, elevation: 0.8, strength: 1 }, out);
    expect(out).toHaveLength(0);
  });

  it('is wider across the sun when the ship lies broadside to it', () => {
    const along = (heading: number): number => {
      const out: Stamp[] = [];
      shadowStamp({ ...ship, heading }, { dirX: 1, dirZ: 0, elevation: 0.7, strength: 1 }, out);
      return out[0]!.width;
    };
    expect(along(Math.PI / 2)).toBeGreaterThan(along(0)); // heading π/2 points along -z: across the sun's +x
  });
});

describe('texture quality', () => {
  it('grows from low to high in filtering and texture sizes', () => {
    expect(TEXTURE_QUALITY.low.anisotropy).toBeLessThan(TEXTURE_QUALITY.high.anisotropy);
    expect(TEXTURE_QUALITY.low.noise).toBeLessThan(TEXTURE_QUALITY.medium.noise);
    expect(TEXTURE_QUALITY.medium.terrain.width).toBeLessThan(TEXTURE_QUALITY.high.terrain.width);
    for (const q of Object.values(TEXTURE_QUALITY)) expect(q.noise & (q.noise - 1)).toBe(0); // powers of two: they are mip-mapped
  });
});
