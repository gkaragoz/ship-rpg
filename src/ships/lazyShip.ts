import * as THREE from 'three';
import type { Condition } from '../core';
import type { Ship } from './factory';
import type { ShipLod } from './lod';

/**
 * A ship that starts as its procedural stand-in and becomes the Blender model once that has loaded.
 *
 * The outer `root` never changes (callers have already added it to a scene), only its child is swapped, and the
 * last sail trim, condition and level of detail are replayed on the new model.
 */
export function createUpgradingShip(placeholder: Ship, load: () => Promise<Ship | undefined>): Ship {
  const root = new THREE.Group();
  root.name = placeholder.spec.id;
  root.add(placeholder.root);
  let inner = placeholder;
  let disposed = false;
  let trim: [number, number] | undefined;
  let condition: [Condition, number] | undefined;
  let lod: ShipLod = 0;

  void load()
    .then((real) => {
      if (!real) return;
      if (disposed) {
        real.dispose();
        return;
      }
      if (trim) real.setSailTrim(...trim);
      if (condition) real.setCondition(...condition);
      real.setLod?.(lod);
      root.remove(inner.root); // swap only once the model is ready, so a throw above keeps the placeholder
      inner.dispose();
      inner = real;
      root.add(real.root);
    })
    .catch((err: unknown) => console.warn(`ship "${placeholder.spec.id}" model could not be shown, keeping the placeholder`, err));

  return {
    spec: placeholder.spec,
    root,
    setSailTrim(windRel, level): void {
      trim = [windRel, level];
      inner.setSailTrim(windRel, level);
    },
    setCondition(c, time): void {
      condition = [c, time];
      inner.setCondition(c, time);
    },
    setLod(next): void {
      lod = next;
      inner.setLod?.(next);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      inner.dispose();
      root.removeFromParent();
    },
  };
}
