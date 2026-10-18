import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CrewAnim, CrewLook, CrewView } from '../core';

/** Body types in asset order: 0-2 male, 3-5 female (docs/CREW.md). */
const VARIANT_FILES = ['Male_Standard', 'Male_Broad', 'Male_Stout', 'Female_Standard', 'Female_Sturdy', 'Female_Stout'] as const;

type Tinted = 'skin' | 'shirt' | 'pants' | 'hair' | 'hat';
const TINT: Record<string, Tinted> = { Skin: 'skin', Shirt: 'shirt', Pants: 'pants', Hair: 'hair', Hat: 'hat' };

/**
 * Camera distance (m) where a sailor drops to LOD1 / LOD2, and where it is hidden. The chase
 * camera can sit 8 ship lengths away (96 m on the tartane), so the crew stays visible there.
 */
const LOD_AT = [25, 60] as const;
const HIDE_AT = 160;
/** Beyond this distance the skeleton is advanced only every fourth frame. */
const FULL_RATE_AT = 30;
const FADE = 0.25;

interface CrewKit {
  scenes: THREE.Group[];
  clips: THREE.AnimationClip[][];
  palette: Record<Tinted, string[]>;
}

let kit: CrewKit | null = null;

/**
 * Preload the six crew GLBs. If anything fails the game still runs: the deck is just empty.
 */
export async function loadCrewAssets(base = `${import.meta.env.BASE_URL}models/crew/`): Promise<void> {
  try {
    const loader = new GLTFLoader();
    const [meta, gltfs] = await Promise.all([
      fetch(`${base}crew.json`).then((r) => {
        if (!r.ok) throw new Error(`crew.json: HTTP ${r.status}`);
        return r.json() as Promise<{ palette: Record<Tinted, string[]> }>;
      }),
      Promise.all(VARIANT_FILES.map((f) => loader.loadAsync(`${base}${f}.glb`))),
    ]);
    kit = { scenes: gltfs.map((g) => g.scene), clips: gltfs.map((g) => g.animations), palette: meta.palette };
  } catch (err) {
    console.warn('crew assets not loaded, the deck stays empty', err);
  }
}

interface Actor {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<CrewAnim, THREE.AnimationAction>>;
  current: CrewAnim;
  lods: (THREE.Object3D | undefined)[];
  lod: number;
  materials: THREE.Material[];
  pending: number;
  tick: number;
}

export interface CrewRenderer {
  /** Parent for the crew: the player's ship model, so they pitch and roll with it. */
  attach(host: THREE.Object3D): void;
  update(views: readonly CrewView[], camera: THREE.Camera): void;
  dispose(): void;
}

function showOptionalParts(root: THREE.Object3D, look: CrewLook): void {
  const hair = look.hairStyle === 'none' ? null : look.hairStyle === 'long' ? 'Hair_Long' : 'Hair_Short';
  const hat = look.hatStyle === 'none' ? null : `Hat_${look.hatStyle === 'wide' ? 'Wide' : look.hatStyle === 'bandana' ? 'Bandana' : 'Cap'}`;
  root.traverse((o) => {
    if (!o.name.startsWith('LOD0_')) return;
    const part = o.name.slice(5);
    if (part.startsWith('Hair')) o.visible = part === hair;
    else if (part === 'Beard') o.visible = look.beard;
    else if (part.startsWith('Hat')) o.visible = part === hat;
  });
}

function spawn(view: CrewView, k: CrewKit): Actor | null {
  const source = k.scenes[view.look.variant];
  const clips = k.clips[view.look.variant];
  if (!source || !clips) return null;
  const root = SkeletonUtils.clone(source);
  const cloned = new Map<string, THREE.Material>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.frustumCulled = false; // skinned bounds follow the bind pose, so culling would pop crew out
    const m = o.material as THREE.MeshStandardMaterial;
    let own = cloned.get(m.name);
    if (!own) {
      own = m.clone();
      cloned.set(m.name, own);
      const slot = TINT[m.name];
      const hex = slot ? k.palette[slot][view.look[slot]] : undefined;
      if (hex) (own as THREE.MeshStandardMaterial).color.set(hex);
    }
    o.material = own;
  });
  showOptionalParts(root, view.look);

  const mixer = new THREE.AnimationMixer(root);
  const actions: Actor['actions'] = {};
  for (const c of clips) actions[c.name as CrewAnim] = mixer.clipAction(c);
  const idle = actions.Idle;
  idle?.play();
  mixer.update((view.id * 0.37) % 2); // de-synchronise the idle sway
  return {
    root, mixer, actions, current: 'Idle', lods: [0, 1, 2].map((l) => root.getObjectByName(`LOD${l}`)), lod: -1,
    materials: [...cloned.values()], pending: 0, tick: view.id,
  };
}

function switchAnim(a: Actor, to: CrewAnim): void {
  const next = a.actions[to];
  const prev = a.actions[a.current];
  if (!next || !prev || a.current === to) return;
  // `crossFadeTo` after `setEffectiveWeight(1)`: never park an action at weight 0 (three multiplies
  // weight by the fade, so it would never come back).
  next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  prev.crossFadeTo(next, FADE, false);
  a.current = to;
}

/** Animated sailors with tinted clothes, drawn from `CrewView` state. Returns null without assets. */
export function createCrewRenderer(): CrewRenderer | null {
  const k = kit;
  if (!k) return null;
  const actors = new Map<number, Actor>();
  const clock = new THREE.Clock();
  const world = new THREE.Vector3();
  let host: THREE.Object3D | null = null;

  const drop = (a: Actor): void => {
    a.mixer.stopAllAction();
    a.root.removeFromParent();
    a.root.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose(); // each clone owns a bone texture
    });
    a.materials.forEach((m) => m.dispose());
  };

  return {
    attach(next): void {
      host = next;
      for (const a of actors.values()) next.add(a.root);
    },

    update(views, camera): void {
      if (!host) return;
      const dt = Math.min(clock.getDelta(), 0.1);
      for (const v of views) {
        let a = actors.get(v.id);
        if (!a) {
          const made = spawn(v, k);
          if (!made) continue;
          a = made;
          actors.set(v.id, a);
          host.add(a.root);
        }
        a.root.position.set(v.x, v.y, v.z);
        a.root.rotation.y = Math.atan2(Math.cos(v.heading), Math.sin(v.heading)); // models face +Z
        switchAnim(a, v.anim);

        a.root.getWorldPosition(world);
        const d = world.distanceTo(camera.position);
        a.root.visible = d < HIDE_AT;
        if (!a.root.visible) continue;
        const lod = d < LOD_AT[0] ? 0 : d < LOD_AT[1] ? 1 : 2;
        if (lod !== a.lod) {
          a.lods.forEach((n, i) => n && (n.visible = i === lod));
          a.lod = lod;
        }
        a.pending += dt;
        if (d < FULL_RATE_AT || ++a.tick % 4 === 0) {
          a.mixer.update(a.pending);
          a.pending = 0;
        }
      }
    },

    dispose(): void {
      actors.forEach(drop);
      actors.clear();
    },
  };
}
