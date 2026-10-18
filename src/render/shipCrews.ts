import type * as THREE from 'three';
import type { CrewView } from '../core';
import { createCrewRenderer, type CrewRenderer } from './crew';

/** A renderer is dropped when its ship has shown no crew for this many frames. */
const DROP_AFTER = 90;

interface Slot {
  renderer: CrewRenderer;
  host: THREE.Object3D;
  idle: number;
}

export interface ShipCrewRenderers {
  /** Show `crew` on `host` (a ship's model) under `key`; an empty or missing crew is how a ship far away reports. */
  update(key: string, host: THREE.Object3D | undefined, crew: readonly CrewView[] | undefined, camera: THREE.Camera): void;
  /** Call once a frame after all the `update`s: forgets ships that stopped reporting. */
  endFrame(): void;
  dispose(): void;
}

/**
 * The sailors of other ships (enemies and patrols): one crew renderer per ship, created when the game starts sending
 * that ship's crew and dropped once it stops (the ship sailed out of range).
 */
export function createShipCrewRenderers(): ShipCrewRenderers {
  const slots = new Map<string, Slot>();
  const touched = new Set<string>();
  return {
    update(key, host, crew, camera): void {
      if (!host || !crew || crew.length === 0) return;
      let slot = slots.get(key);
      if (slot && slot.host !== host) {
        slot.renderer.dispose();
        slots.delete(key);
        slot = undefined;
      }
      if (!slot) {
        const renderer = createCrewRenderer();
        if (!renderer) return;
        renderer.attach(host);
        slot = { renderer, host, idle: 0 };
        slots.set(key, slot);
      }
      slot.idle = 0;
      touched.add(key);
      slot.renderer.update(crew, camera);
    },
    endFrame(): void {
      for (const [key, slot] of slots) {
        if (touched.has(key)) continue;
        if (++slot.idle > DROP_AFTER) {
          slot.renderer.dispose();
          slots.delete(key);
        }
      }
      touched.clear();
    },
    dispose(): void {
      for (const s of slots.values()) s.renderer.dispose();
      slots.clear();
    },
  };
}
