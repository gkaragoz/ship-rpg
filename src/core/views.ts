/**
 * Read-only snapshots and plain input shared between modules, so `render` and `ui`
 * can show game state without importing `gameplay`.
 *
 * World convention (metres, radians): x east, z south, y up. A heading ψ points the
 * bow along (cos ψ, -sin ψ); ψ = 0 is east and increasing ψ turns to port. Wind
 * `from` uses the same angle convention (the direction the wind comes FROM).
 */
export interface Controls {
  /** -1 full port … +1 full starboard. */
  rudder: number;
  /** One-shot sail change this step: +1 more sail, -1 less, 0 none. */
  sailStep: -1 | 0 | 1;
}

export interface WindView {
  from: number;
  /** m/s */
  speed: number;
}

export interface ShipView {
  x: number;
  z: number;
  heading: number;
  /** m/s */
  speed: number;
  /** Speed in the original game's units (the `speed` stat scale). */
  knots: number;
  maxKnots: number;
  rudder: number;
  /** Actual sail deployment 0 (furled) … 1 (full). */
  sailLevel: number;
  /** Target sail deployment chosen by the player. */
  sailTarget: number;
  /** Current sail drive 0…1 from the wind angle (0 = in irons). */
  efficiency: number;
  /** Heel about the bow axis in radians; + heels to starboard. */
  roll: number;
}

/** Another ship at sea; kinematic and shown at a distance-dependent level of detail. */
export interface OtherShipView {
  id: number;
  /** Which ship spec (and model) to draw. */
  specId: string;
  x: number;
  z: number;
  heading: number;
  sailLevel: number;
  roll: number;
}

export type CrewAnim = 'Idle' | 'Walk' | 'Run';

/** Appearance choices; palette entries are indices into the crew asset's palette. */
export interface CrewLook {
  /** 0-2 male, 3-5 female (body types in the order of the crew asset). */
  variant: number;
  skin: number;
  shirt: number;
  pants: number;
  hair: number;
  hat: number;
  hairStyle: 'short' | 'long' | 'none';
  hatStyle: 'wide' | 'bandana' | 'cap' | 'none';
  beard: boolean;
}

/**
 * A sailor on the player's deck, in ship-local space (+x bow, +y up, +z starboard).
 * `heading` faces (cos h, sin h) in the (x, z) plane.
 */
export interface CrewView {
  id: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  anim: CrewAnim;
  look: CrewLook;
}

export interface GameView {
  time: number;
  ship: ShipView;
  wind: WindView;
  others: OtherShipView[];
  crew: CrewView[];
}
