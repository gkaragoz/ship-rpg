import * as THREE from 'three';
import type { CrewAnim } from '../core';

/** The bones a pose moves, with the rest rotation each came with (the arms and legs are authored flipped: see docs/CREW.md). */
export interface PoseBones {
  hips: THREE.Object3D;
  spine: THREE.Object3D;
  head: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  foreL: THREE.Object3D;
  foreR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  shinL: THREE.Object3D;
  shinR: THREE.Object3D;
  rest: Map<THREE.Object3D, THREE.Quaternion>;
}

/** `GLTFLoader` strips the dots from node names: `UpperArm.L` is `UpperArmL`. */
export function findBones(root: THREE.Object3D): PoseBones | null {
  const get = (name: string): THREE.Object3D | undefined => root.getObjectByName(name);
  const found = {
    hips: get('Hips'), spine: get('Spine'), head: get('Head'),
    armL: get('UpperArmL'), armR: get('UpperArmR'), foreL: get('LowerArmL'), foreR: get('LowerArmR'),
    legL: get('UpperLegL'), legR: get('UpperLegR'), shinL: get('LowerLegL'), shinR: get('LowerLegR'),
  };
  if (Object.values(found).some((b) => !b)) return null;
  const bones = found as Omit<PoseBones, 'rest'>;
  const rest = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const b of Object.values(bones)) rest.set(b, b.quaternion.clone());
  return { ...bones, rest };
}

/** Animations the renderer poses by hand on top of the idle clip (everything but the authored Walk and Run). */
export const POSED: ReadonlySet<CrewAnim> = new Set<CrewAnim>(['Helm', 'Haul', 'Climb', 'Aloft', 'Load', 'Fire', 'Fly', 'Swim', 'Drown']);

const q = new THREE.Quaternion();
const e = new THREE.Euler();

/** Rotate `bone` from its rest rotation by (x, y, z) radians in its own frame. */
function set(b: PoseBones, bone: THREE.Object3D, x: number, y = 0, z = 0): void {
  const rest = b.rest.get(bone);
  if (!rest) return;
  bone.quaternion.copy(rest).multiply(q.setFromEuler(e.set(x, y, z)));
}

/** Reaching forward and up is a negative x on the arms; swinging a leg forward is a negative x too. */
const FORWARD = -1;

/**
 * Pose the skeleton for a working or floating animation at `clock` seconds with parameter `lean`. Bones are set
 * absolutely from their rest rotation every call, so nothing accumulates. `seed` de-synchronises neighbours.
 */
export function applyPose(b: PoseBones, anim: CrewAnim, clock: number, lean: number, seed: number): void {
  const t = clock + seed * 0.37;
  switch (anim) {
    case 'Helm': {
      // both hands on the wheel in front, the wheel turning with the rudder
      set(b, b.armL, FORWARD * (1.05 + lean * 0.35), 0, 0.12);
      set(b, b.armR, FORWARD * (1.05 - lean * 0.35), 0, -0.12);
      set(b, b.foreL, FORWARD * 0.5);
      set(b, b.foreR, FORWARD * 0.5);
      set(b, b.spine, 0.06 + Math.abs(lean) * 0.08, lean * 0.18);
      set(b, b.head, 0, -lean * 0.25);
      break;
    }
    case 'Haul': {
      // hauling a line hand over hand: the body rocks back as the arms come in
      const p = t * 3.4;
      const pull = 0.5 + 0.5 * Math.sin(p);
      set(b, b.armL, FORWARD * (1.7 - 0.9 * pull), 0, 0.1);
      set(b, b.armR, FORWARD * (1.7 - 0.9 * (1 - pull)), 0, -0.1);
      set(b, b.foreL, FORWARD * (0.3 + 0.9 * pull));
      set(b, b.foreR, FORWARD * (0.3 + 0.9 * (1 - pull)));
      set(b, b.spine, -0.12 - 0.22 * pull);
      set(b, b.legL, FORWARD * 0.25);
      set(b, b.legR, -FORWARD * 0.2);
      break;
    }
    case 'Climb': {
      // up the shrouds: hand over hand, knees alternating
      const p = t * 5;
      const s = Math.sin(p);
      set(b, b.armL, FORWARD * (2.4 + 0.45 * s));
      set(b, b.armR, FORWARD * (2.4 - 0.45 * s));
      set(b, b.foreL, FORWARD * (0.4 + 0.3 * Math.max(0, -s)));
      set(b, b.foreR, FORWARD * (0.4 + 0.3 * Math.max(0, s)));
      set(b, b.legL, FORWARD * (0.55 - 0.55 * s));
      set(b, b.legR, FORWARD * (0.55 + 0.55 * s));
      set(b, b.shinL, 0.6 * Math.max(0, s));
      set(b, b.shinR, 0.6 * Math.max(0, -s));
      set(b, b.spine, 0.12);
      break;
    }
    case 'Aloft': {
      // standing on the yard, arms out for balance, one hand now and then at the sail
      set(b, b.armL, 0, 0, 1.35 + 0.12 * Math.sin(t * 1.7));
      set(b, b.armR, 0, 0, -1.35 - 0.12 * Math.sin(t * 1.3 + 1));
      set(b, b.foreL, FORWARD * 0.2 * (0.5 + 0.5 * Math.sin(t * 2.4)));
      set(b, b.legL, FORWARD * 0.1);
      set(b, b.legR, FORWARD * -0.1);
      set(b, b.spine, 0.05, Math.sin(t * 0.9) * 0.25);
      set(b, b.head, 0, Math.sin(t * 0.9 + 1) * 0.35);
      break;
    }
    case 'Load': {
      // ramming the charge home: bent over the gun, both arms pushing along the rammer
      const p = t * 4.2;
      const push = 0.5 + 0.5 * Math.sin(p);
      set(b, b.armL, FORWARD * (1.0 + 0.7 * push), 0, 0.08);
      set(b, b.armR, FORWARD * (1.0 + 0.7 * push), 0, -0.08);
      set(b, b.foreL, FORWARD * (0.9 - 0.7 * push));
      set(b, b.foreR, FORWARD * (0.9 - 0.7 * push));
      set(b, b.spine, 0.35 + 0.15 * push);
      set(b, b.legL, FORWARD * 0.35);
      set(b, b.legR, -FORWARD * 0.25);
      break;
    }
    case 'Fire': {
      // at the shot: one arm out with the linstock, the body thrown back when the gun speaks
      const kick = Math.sin(Math.min(lean, 1) * Math.PI);
      set(b, b.armR, FORWARD * 1.5, 0, -0.1);
      set(b, b.foreR, FORWARD * 0.15);
      set(b, b.armL, FORWARD * 0.5, 0, 0.35);
      set(b, b.spine, -0.1 - 0.35 * kick);
      set(b, b.head, -0.2 * kick);
      set(b, b.legL, FORWARD * -0.2);
      set(b, b.legR, FORWARD * 0.3);
      break;
    }
    case 'Fly': {
      // thrown through the air: the limbs trail and flail with the tumble
      const p = t * 7;
      set(b, b.armL, FORWARD * (1.2 + 1.2 * Math.sin(p)), 0, 0.9 + 0.5 * Math.sin(p * 1.3));
      set(b, b.armR, FORWARD * (1.2 + 1.2 * Math.sin(p + 2)), 0, -0.9 - 0.5 * Math.sin(p * 1.1 + 1));
      set(b, b.foreL, FORWARD * (0.5 + 0.5 * Math.sin(p * 1.7)));
      set(b, b.foreR, FORWARD * (0.5 + 0.5 * Math.sin(p * 1.9 + 1)));
      set(b, b.legL, FORWARD * (0.6 + 0.6 * Math.sin(p * 1.2 + 0.5)), 0, 0.25);
      set(b, b.legR, FORWARD * (0.6 + 0.6 * Math.sin(p * 1.4 + 2)), 0, -0.25);
      set(b, b.shinL, 0.5 + 0.4 * Math.sin(p));
      set(b, b.shinR, 0.5 + 0.4 * Math.sin(p + 1.5));
      set(b, b.spine, 0.2 * Math.sin(p * 0.8));
      break;
    }
    case 'Swim': {
      // flailing at the surface: alternating overhead strokes and a kick, head up; tiring as `lean` (0…1) grows
      const tired = 1 - 0.55 * lean;
      const p = t * (4.2 - 1.6 * lean);
      const s = Math.sin(p);
      set(b, b.armL, FORWARD * (2.1 + 0.8 * s) * tired, 0, 0.35);
      set(b, b.armR, FORWARD * (2.1 - 0.8 * s) * tired, 0, -0.35);
      set(b, b.foreL, FORWARD * 0.5 * (1 + Math.max(0, s)));
      set(b, b.foreR, FORWARD * 0.5 * (1 + Math.max(0, -s)));
      set(b, b.legL, FORWARD * -0.1 + 0.35 * Math.sin(p * 1.6));
      set(b, b.legR, FORWARD * -0.1 - 0.35 * Math.sin(p * 1.6));
      set(b, b.head, -0.5);
      break;
    }
    case 'Drown': {
      // giving up: the arms rise and go slack, the head drops back
      const sink = Math.min(clock / 4, 1);
      set(b, b.armL, FORWARD * (2.6 - 0.5 * sink), 0, 0.5 + 0.4 * sink + 0.1 * Math.sin(t * 2));
      set(b, b.armR, FORWARD * (2.6 - 0.5 * sink), 0, -0.5 - 0.4 * sink - 0.1 * Math.sin(t * 2.3));
      set(b, b.foreL, FORWARD * 0.2);
      set(b, b.foreR, FORWARD * 0.2);
      set(b, b.legL, FORWARD * -0.2);
      set(b, b.legR, FORWARD * 0.1);
      set(b, b.head, -0.7 * sink);
      break;
    }
    default:
      break;
  }
}
