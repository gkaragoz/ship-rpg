import * as THREE from 'three';
import type { CrewView, GameEvent } from '../core';
import { createCrewRenderer, randomLook, type CrewRenderer } from './crew';
import { MAX_SWIMMERS, flungByHit, spilledBySinking, stepSwimmers, swimRng, type Swimmer } from './swimmerSim';
import type { CrewAnim } from '../core';

/** Chance that a cannonball strike throws a sailor into the sea: on the hull, in the rigging. */
const FLING_HULL = 0.3;
const FLING_RIGGING = 0.1;
/** Fewest and most sailors a sinking ship spills (it never spills more than are visible on a deck). */
const SPILL = [4, 14] as const;
/** Lowest height of a hit worth a thrown sailor: shots into the waterline spare the deck crew. */
const DECK_HEIGHT = 1.2;

export interface Swimmers {
  /** Throw sailors into the sea for the hits and sinkings among these events. */
  spawn(events: readonly GameEvent[]): void;
  /** Advance and draw; returns the splashes of sailors that hit the water this frame (for the particle effects). */
  update(dt: number, camera: THREE.Camera, surface: (x: number, z: number) => number): GameEvent[];
  dispose(): void;
}

const ANIM: Record<Swimmer['phase'], CrewAnim> = { fly: 'Fly', swim: 'Swim', drown: 'Drown' };

/**
 * Rag-doll sailors in the water: flung off the deck by a hit or spilled by a sinking, they tumble through the air with
 * flailing limbs, land with a splash, swim for a while and tire, then drown (see `swimmerSim.ts`). Decoration only; it
 * needs the crew models and does nothing without them.
 */
export function createSwimmers(scene: THREE.Scene): Swimmers {
  const group = new THREE.Group();
  group.name = 'swimmers';
  scene.add(group);
  const renderer: CrewRenderer | null = createCrewRenderer();
  renderer?.attach(group);
  const list: Swimmer[] = [];
  const looks = new Map<number, CrewView['look']>();
  const rand = swimRng(0x5eed);
  const views: CrewView[] = [];
  const splashes: GameEvent[] = [];

  const add = (swimmers: Swimmer[]): void => {
    for (const s of swimmers) {
      if (list.length >= MAX_SWIMMERS) break;
      list.push(s);
    }
  };

  return {
    spawn(events): void {
      if (!renderer) return;
      for (const e of events) {
        if (e.type === 'hit' && e.y >= DECK_HEIGHT) {
          const p = e.zone === 'hull' ? FLING_HULL : e.zone === 'rigging' ? FLING_RIGGING : 0;
          if (rand() < p) add([flungByHit(e.x, e.y, e.z, e.nx ?? rand() - 0.5, e.nz ?? rand() - 0.5, rand)]);
        } else if (e.type === 'sunk' && e.length) {
          const n = Math.min(SPILL[1], Math.max(SPILL[0], Math.round(e.length * 0.3)));
          add(spilledBySinking(e.x, Math.max(e.length * 0.07, 1.5), e.z, e.length, n, rand));
        }
      }
    },

    update(dt, camera, surface): GameEvent[] {
      splashes.length = 0;
      if (!renderer || list.length === 0) {
        if (renderer) renderer.update([], camera);
        return splashes;
      }
      stepSwimmers(list, { surface, splash: (x, z, speed) => splashes.push({ type: 'splash', owner: 'enemy', x, y: surface(x, z), z, speed }) }, dt);
      views.length = 0;
      for (const s of list) {
        if (s.delay > 0) continue;
        let look = looks.get(s.id);
        if (!look) {
          look = randomLook(swimRng(Math.floor(s.seed * 1000) + 1)) ?? undefined;
          if (!look) continue;
          looks.set(s.id, look);
        }
        views.push({
          id: s.id, x: s.x, y: s.y, z: s.z, heading: Math.PI / 2 - s.yaw, anim: ANIM[s.phase], look,
          clock: s.t, lean: s.phase === 'swim' ? Math.min(s.t / s.swimFor, 1) : 0,
          pitch: s.phase === 'fly' ? s.pitch : s.pitch - 0.25, roll: s.roll,
        });
      }
      renderer.update(views, camera);
      if (looks.size > list.length + 24) {
        const alive = new Set(list.map((s) => s.id));
        for (const id of looks.keys()) if (!alive.has(id)) looks.delete(id);
      }
      return splashes;
    },

    dispose(): void {
      renderer?.dispose();
      scene.remove(group);
      list.length = 0;
      looks.clear();
    },
  };
}
