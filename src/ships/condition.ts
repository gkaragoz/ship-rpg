import * as THREE from 'three';
import type { Condition } from '../core';
import type { ShipSpec } from './types';
import type { ShipMaterials } from './materials';
import { bulwark, deckHeight } from './hullShape';

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

const PRISTINE_SAIL = new THREE.Color(0xefe6cf);
const SCORCHED_SAIL = new THREE.Color(0x4a3d33);
/** Sail height at rigging 0. */
const MIN_SAIL_HEIGHT = 0.55;
/** Rigging below which each sail tier (index = tier) is gone; the courses (tier 0) stay. */
const TIER_GONE_BELOW = [0, 0.66, 0.8, 0.88];
const SINK_DRAFT = 0.35;
const MAX_LIST = 0.18;

/** Rigging, flooding and fire shown on one ship model. Mutates transforms and materials only. */
export interface ConditionRig {
  /** Height factor (0.55…1) the damaged sails scale by, on top of the wind trim. */
  readonly sailHeight: () => number;
  apply(c: Condition, time: number): void;
  dispose(): void;
}

/** `pivot` holds every part of the ship; `onSailHeight` is called when damage changes sail height. */
export function createConditionRig(spec: ShipSpec, mats: ShipMaterials, pivot: THREE.Group, onSailHeight: () => void): ConditionRig {
  const sail = mats.sail as THREE.MeshStandardMaterial;
  const tiers: { group: THREE.Object3D; goneBelow: number }[] = [];
  pivot.traverse((o) => {
    const match = /^sail-tier-(\d+)$/.exec(o.name);
    if (match) tiers.push({ group: o, goneBelow: TIER_GONE_BELOW[Math.min(Number(match[1]), TIER_GONE_BELOW.length - 1)] ?? 0 });
  });

  // Flames: one cone geometry shared by a fixed pool, two additive-looking materials.
  const geometry = new THREE.ConeGeometry(0.5, 1, 5);
  geometry.translate(0, 0.5, 0); // base at the origin
  const flameMats = [0xff6a1a, 0xffc830].map((color) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  const size = Math.max(spec.beam * 0.28, 0.8);
  const spots = flameSpots(spec);
  const flames = spots.map((p, i) => {
    const mesh = new THREE.Mesh(geometry, flameMats[i % 2]);
    mesh.name = 'flame';
    mesh.position.copy(p);
    mesh.visible = false;
    pivot.add(mesh);
    return mesh;
  });

  let height = 1;
  return {
    sailHeight: () => height,
    apply(c, time): void {
      const rigging = clamp01(c.rigging);
      const flooding = clamp01(c.flooding);
      const fire = clamp01(c.fire);

      sail.color.copy(PRISTINE_SAIL).lerp(SCORCHED_SAIL, 1 - rigging);
      const h = MIN_SAIL_HEIGHT + (1 - MIN_SAIL_HEIGHT) * rigging;
      for (const t of tiers) t.group.visible = rigging >= t.goneBelow;
      if (h !== height) {
        height = h;
        onSailHeight();
      }

      pivot.position.y = 0 - SINK_DRAFT * spec.draft * flooding;
      pivot.rotation.x = flooding * (MAX_LIST + 0.02 * Math.sin(time * 0.9));

      const count = fire > 0 ? Math.min(flames.length, Math.ceil(fire * flames.length)) : 0;
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i];
        if (!f) continue;
        const on = i < count;
        f.visible = on;
        if (!on) {
          f.scale.set(1, 1, 1);
          f.rotation.y = 0;
          continue;
        }
        const flick = 1 + 0.25 * Math.sin(time * 11 + i * 2.3) + 0.15 * Math.sin(time * 17.3 + i * 5.1);
        const tall = size * (0.5 + 1.1 * fire) * flick;
        const wide = size * (0.6 + 0.5 * fire) * (1 + 0.12 * Math.sin(time * 13 + i * 1.7));
        f.scale.set(wide, tall, wide);
        f.rotation.y = i * 1.3 + time * 0.7;
      }
    },
    dispose(): void {
      geometry.dispose();
      for (const m of flameMats) m.dispose();
      for (const f of flames) pivot.remove(f);
    },
  };
}

/** Fixed flame positions: mast bases, then sterncastle, then bow. Ship space. */
function flameSpots(spec: ShipSpec): THREE.Vector3[] {
  const lift = bulwark(spec) * 0.5;
  const spots = spec.masts
    .slice(0, 4)
    .map((m) => new THREE.Vector3((0.5 - m.at) * spec.length, deckHeight(spec, 1 - m.at) - bulwark(spec) + lift, 0));
  spots.push(new THREE.Vector3(-0.38 * spec.length, deckHeight(spec, 0.12) + lift, 0));
  spots.push(new THREE.Vector3(0.36 * spec.length, deckHeight(spec, 0.9) + lift, 0));
  return spots;
}
