/**
 * Ship data model. Units: metres. Ship local space: +x is the bow, +y up,
 * y = 0 is the waterline, z is the beam axis (+z starboard).
 */
export type Rig = 'square' | 'lateen' | 'gaff' | 'lug';
export type SizeClass = 'small' | 'medium' | 'large';

export interface MastSpec {
  /** Position along the hull, 0 = bow, 1 = stern. */
  at: number;
  /** Mast height above deck. */
  height: number;
  rig: Rig;
  /** Square rig only: number of stacked sails. */
  tiers?: number;
  /** Square rig only: add a gaff sail behind the mast. */
  spanker?: boolean;
  /** Aft lean in radians (negative leans forward). */
  rake?: number;
}

export interface CastleSpec {
  /** Fraction of hull length. */
  length: number;
  /** Height above deck in metres. */
  height: number;
  /** Extra stepped tiers (each shorter and lower). */
  stepped?: number;
}

/**
 * Gameplay stats from the original game's data tables (GameFAQs "Data Tables"
 * by DrdLord, v1.1). Values are the approximate base before the shipyards'
 * regional modifiers (about ±5%, hold/crew up to ±10%); single-row ships are
 * used as listed. See docs/SHIPS.md.
 */
export interface ShipStats {
  /** Original class number, 7 (smallest) to 1 (largest). */
  rank: number;
  hp: number;
  speed: number;
  turn: number;
  hold: number;
  crew: number;
  officers: number;
  cannons: number;
  /** Cannon calibre in pounds. */
  shot: number;
  /** Shipyard price (guide's `$` column; unit not stated, probably thousands). */
  price: number;
}

export interface ShipSpec {
  id: string;
  name: string;
  sizeClass: SizeClass;
  /** Short Turkish blurb shown in the gallery. */
  description: string;
  length: number;
  beam: number;
  /** Depth of keel below waterline. */
  draft: number;
  /** Deck height above waterline amidships. */
  freeboard: number;
  /** Extra deck lift at bow and stern. */
  sheer: number;
  masts: MastSpec[];
  jibs: number;
  /** Bowsprit length beyond the bow, 0 for none. */
  bowsprit: number;
  forecastle?: CastleSpec;
  sterncastle?: CastleSpec;
  stats: ShipStats;
  /** Visual rows of gun ports; port count comes from `stats.cannons`. */
  gunDecks: number;
  /** Oars per side. */
  oars: number;
  hullColor: number;
  trimColor: number;
}
