import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createDeck, type Deck, type ShipModelMeta } from './deck';

/** A Blender-made ship model, loaded once and cloned per ship (geometry, textures and materials are shared). */
export interface ShipAsset {
  readonly id: string;
  readonly scene: THREE.Group;
  readonly meta: ShipModelMeta;
  readonly deck: Deck;
}

/** Ships that have a GLB under public/models/ships/<id>.glb; every other ship stays procedural. */
export const GLB_SHIP_IDS: readonly string[] = [
  'tartane', 'yacht', 'lugger', 'sloop', 'schooner', 'barque', 'xebec', 'galeoth',
  'caravel', 'fleut', 'brig', 'pinnace', 'corvette', 'galleon', 'frigate', 'battleship',
];

/** Anisotropic filtering for the baked hull, deck and sail textures (the renderer clamps it to what the GPU has). */
const ANISOTROPY = 8;

const assets = new Map<string, ShipAsset>();
const pending = new Map<string, Promise<ShipAsset | undefined>>();
let loader: GLTFLoader | undefined;

function gltfLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder); // the PBR ships store their geometry meshopt-compressed
  }
  return loader;
}

function sharpenTextures(scene: THREE.Object3D): void {
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
    const m = o.material;
    for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap]) if (t) t.anisotropy = ANISOTROPY;
  });
}

async function fetchAsset(id: string, base: string): Promise<ShipAsset | undefined> {
  try {
    const [gltf, res] = await Promise.all([gltfLoader().loadAsync(`${base}${id}.glb`), fetch(`${base}${id}.meta.json`)]);
    if (!res.ok) throw new Error(`${id}.meta.json: HTTP ${res.status}`);
    const meta = (await res.json()) as ShipModelMeta;
    sharpenTextures(gltf.scene);
    const asset: ShipAsset = { id, scene: gltf.scene, meta, deck: createDeck(meta) };
    assets.set(id, asset);
    return asset;
  } catch (err) {
    console.warn(`GLB ship "${id}" not loaded, using the procedural ship`, err);
    return undefined;
  }
}

/**
 * Load one ship model on demand (once; concurrent callers share the request). Resolves to `undefined` when the
 * model is missing or broken, so callers keep the procedural ship and the game never depends on the network.
 */
export function requestShipAsset(id: string, base = `${import.meta.env.BASE_URL}models/ships/`): Promise<ShipAsset | undefined> {
  const have = assets.get(id);
  if (have) return Promise.resolve(have);
  let p = pending.get(id);
  if (!p) {
    p = fetchAsset(id, base).finally(() => pending.delete(id));
    pending.set(id, p);
  }
  return p;
}

/**
 * Preload ships (by default none: `createShip` loads the model of every ship it builds and swaps it in, so only
 * the ships that are actually shown are fetched).
 */
export async function loadShipAssets(ids: readonly string[] = [], base?: string): Promise<void> {
  await Promise.all(ids.map((id) => requestShipAsset(id, base)));
}

export const getShipAsset = (id: string): ShipAsset | undefined => assets.get(id);

/** Walkable deck of a ship, available only once its GLB has been loaded. */
export const getDeck = (id: string): Deck | undefined => assets.get(id)?.deck;
