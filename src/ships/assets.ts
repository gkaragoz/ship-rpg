import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createDeck, type Deck, type ShipModelMeta } from './deck';

/** A Blender-made ship model, loaded once and cloned per ship (geometry and materials are shared). */
export interface ShipAsset {
  readonly id: string;
  readonly scene: THREE.Group;
  readonly meta: ShipModelMeta;
  readonly deck: Deck;
}

/** Ships that have a GLB under public/models/ships/<id>.glb; every other ship stays procedural. */
export const GLB_SHIP_IDS: readonly string[] = ['tartane'];

const assets = new Map<string, ShipAsset>();

/**
 * Preload the GLB ships. A model that fails to load only logs a warning: `createShip` then
 * falls back to the procedural ship, so the game never depends on the network for a ship.
 */
export async function loadShipAssets(base = `${import.meta.env.BASE_URL}models/ships/`): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    GLB_SHIP_IDS.map(async (id) => {
      try {
        const [gltf, res] = await Promise.all([loader.loadAsync(`${base}${id}.glb`), fetch(`${base}${id}.meta.json`)]);
        if (!res.ok) throw new Error(`${id}.meta.json: HTTP ${res.status}`);
        const meta = (await res.json()) as ShipModelMeta;
        assets.set(id, { id, scene: gltf.scene, meta, deck: createDeck(meta) });
      } catch (err) {
        console.warn(`GLB ship "${id}" not loaded, using the procedural ship`, err);
      }
    }),
  );
}

export const getShipAsset = (id: string): ShipAsset | undefined => assets.get(id);

/** Walkable deck of a ship, available only for GLB ships. */
export const getDeck = (id: string): Deck | undefined => assets.get(id)?.deck;
