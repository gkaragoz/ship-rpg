import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SHIP_SPECS, createShip, getShipSpec } from '../src/ships';
import type { Ship } from '../src/ships';

const PRISTINE = { rigging: 1, flooding: 0, fire: 0 };
const named = (ship: Ship, prefix: string): THREE.Object3D[] => {
  const out: THREE.Object3D[] = [];
  ship.root.traverse((o) => {
    if (o.name.startsWith(prefix)) out.push(o);
  });
  return out;
};
const count = (ship: Ship): number => {
  let n = 0;
  ship.root.traverse(() => n++);
  return n;
};
const sailColor = (ship: Ship): number => {
  let hex = -1;
  ship.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial && o.material.roughness === 1) hex = o.material.color.getHex();
  });
  return hex;
};
const galleon = (): Ship => {
  const spec = getShipSpec('battleship');
  if (!spec) throw new Error('missing spec');
  return createShip(spec);
};
const visibleFlames = (s: Ship): number => named(s, 'flame').filter((f) => f.visible).length;
const visibleTiers = (s: Ship): number[] => named(s, 'sail-tier-').filter((t) => t.visible).map((t) => Number(t.name.slice(10)));

describe('setCondition rigging', () => {
  it('drops upper tiers in steps and keeps courses', () => {
    const s = galleon();
    expect(Math.max(...visibleTiers(s))).toBeGreaterThanOrEqual(2);
    s.setCondition({ ...PRISTINE, rigging: 0.85 }, 0);
    expect(Math.max(...visibleTiers(s))).toBe(2);
    s.setCondition({ ...PRISTINE, rigging: 0.7 }, 0);
    expect(Math.max(...visibleTiers(s))).toBe(1);
    s.setCondition({ ...PRISTINE, rigging: 0.5 }, 0);
    expect(new Set(visibleTiers(s))).toEqual(new Set([0]));
    s.setCondition({ ...PRISTINE, rigging: 0.9 }, 0);
    expect(Math.max(...visibleTiers(s))).toBe(2);
    s.setCondition({ ...PRISTINE, rigging: 0 }, 0);
    expect(new Set(visibleTiers(s))).toEqual(new Set([0]));
  });

  it('darkens cloth on this ship only', () => {
    const a = galleon();
    const b = galleon();
    const before = sailColor(b);
    a.setCondition({ ...PRISTINE, rigging: 0 }, 0);
    expect(sailColor(a)).not.toBe(before);
    expect(sailColor(b)).toBe(before);
  });

  it('shrinks sails and combines with setSailTrim', () => {
    const s = galleon();
    const sq = named(s, 'trim-square')[0] as THREE.Object3D;
    s.setSailTrim(0.5, 1);
    s.setCondition({ ...PRISTINE, rigging: 0 }, 0);
    expect(sq.scale.y).toBeCloseTo(0.55, 5);
    s.setSailTrim(0.5, 0.5);
    expect(sq.scale.y).toBeCloseTo((0.35 + 0.65 * 0.5) * 0.55, 5);
    s.setSailTrim(0.5, 0); // furled
    expect(sq.visible).toBe(false);
    s.setCondition({ ...PRISTINE, rigging: 0.4 }, 1);
    expect(sq.visible).toBe(false);
    s.setSailTrim(-1, 1);
    s.setCondition({ ...PRISTINE, rigging: 0.4 }, 1);
    const aft = named(s, 'trim-aft')[0];
    if (aft) expect(aft.scale.z).toBe(-1);
  });
});

describe('setCondition flooding', () => {
  it('sinks and lists the pivot, never the root', () => {
    const s = galleon();
    const pivot = s.root.getObjectByName('pivot') as THREE.Object3D;
    s.root.position.set(1, 2, 3);
    s.setCondition({ ...PRISTINE, flooding: 1 }, 5);
    expect(pivot.position.y).toBeCloseTo(-0.35 * s.spec.draft, 5);
    expect(pivot.rotation.x).toBeGreaterThan(0.15);
    expect(s.root.position.toArray()).toEqual([1, 2, 3]);
    expect(s.root.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  });
});

describe('setCondition fire', () => {
  it('shows more flames as fire grows and none at zero', () => {
    const s = galleon();
    expect(visibleFlames(s)).toBe(0);
    s.setCondition({ ...PRISTINE, fire: 0.1 }, 1);
    const low = visibleFlames(s);
    s.setCondition({ ...PRISTINE, fire: 1 }, 1);
    const high = visibleFlames(s);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
    s.setCondition(PRISTINE, 1);
    expect(visibleFlames(s)).toBe(0);
  });

  it('flickers deterministically with time', () => {
    const s = galleon();
    const f = named(s, 'flame')[0] as THREE.Object3D;
    s.setCondition({ ...PRISTINE, fire: 1 }, 1);
    const h1 = f.scale.y;
    s.setCondition({ ...PRISTINE, fire: 1 }, 1.3);
    expect(f.scale.y).not.toBe(h1);
    s.setCondition({ ...PRISTINE, fire: 1 }, 1);
    expect(f.scale.y).toBe(h1);
  });
});

describe('setCondition lifecycle', () => {
  it('restores the pristine look exactly', () => {
    const s = galleon();
    s.setSailTrim(0.5, 1);
    const snap = (): string => {
      const parts: string[] = [sailColor(s).toString()];
      s.root.traverse((o) => parts.push(`${o.visible}${o.position.toArray()}${o.rotation.toArray()}${o.scale.toArray()}`));
      return parts.join('|');
    };
    s.setCondition(PRISTINE, 0);
    const before = snap();
    s.setCondition({ rigging: 0.1, flooding: 0.8, fire: 0.9 }, 7);
    expect(snap()).not.toBe(before);
    s.setCondition(PRISTINE, 9);
    expect(snap()).toBe(before);
  });

  it('does not grow the scene over many calls', () => {
    const s = galleon();
    const n = count(s);
    for (let i = 0; i < 500; i++) s.setCondition({ rigging: (i % 10) / 10, flooding: (i % 7) / 7, fire: (i % 5) / 5 }, i * 0.016);
    expect(count(s)).toBe(n);
  });

  it('disposes flame geometry and materials', () => {
    const s = galleon();
    const flame = named(s, 'flame')[0] as THREE.Mesh;
    let geo = 0;
    let mat = 0;
    flame.geometry.addEventListener('dispose', () => geo++);
    if (flame.material instanceof THREE.Material) flame.material.addEventListener('dispose', () => mat++);
    s.dispose();
    expect(geo).toBe(1);
    expect(mat).toBe(1);
  });

  it.each(SHIP_SPECS.map((sp) => [sp.id, sp] as const))('%s works at full damage and restores', (_id, spec) => {
    const s = createShip(spec);
    s.setCondition({ rigging: 0, flooding: 1, fire: 1 }, 3);
    expect(visibleFlames(s)).toBeGreaterThan(0);
    expect(s.root.getObjectByName('hull')).toBeDefined();
    const box = new THREE.Box3().setFromObject(s.root);
    expect(Number.isFinite(box.min.y) && Number.isFinite(box.max.y)).toBe(true);
    s.setCondition(PRISTINE, 4);
    expect(visibleFlames(s)).toBe(0);
    s.dispose();
  });
});
