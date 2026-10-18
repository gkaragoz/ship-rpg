export { createShip } from './factory';
export type { Ship, ShipOptions } from './factory';
export { SHIP_SPECS, getShipSpec } from './specs';
export type { ShipSpec, ShipStats, MastSpec, CastleSpec, Rig, SizeClass } from './types';
export { loadShipAssets, requestShipAsset, getDeck, getShipAsset } from './assets';
export { createDeck } from './deck';
export type { Deck, DeckObstacle, ShipModelMeta } from './deck';
export { LOD_RANGES, selectLod, lodUpdateDue } from './lod';
export type { ShipLod } from './lod';
