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
  /** One-shot: dock at / leave the nearest port. */
  interact?: boolean;
  /** One-shot: fire the port (left) or starboard (right) broadside. */
  firePort?: boolean;
  fireStarboard?: boolean;
  /** One-shot: start over after the ship has sunk. */
  restart?: boolean;
}

export type Owner = 'player' | 'enemy';

/** Where on a ship a ball struck, by its height: just above the sea, the hull proper, or the rigging above the deck. */
export type HitZone = 'waterline' | 'hull' | 'rigging';

/**
 * How battered a ship is, each 0…1. Shared by `ShipView` (the player) and `EnemyView`, and what the ship
 * models and effects draw: torn sails, a ship sitting low in the water, flames.
 */
export interface Condition {
  /** Health of sails and rigging: 1 intact, 0 wrecked. Slows the ship and blunts its turning. */
  rigging: number;
  /** Water in the hull: 0 dry, 1 about to founder. */
  flooding: number;
  /** Fire: 0 none, 1 raging. */
  fire: number;
}

export interface WindView {
  from: number;
  /** m/s */
  speed: number;
}

/** Where a broadside lands (metres): see `gameplay/combat.ts` `aimZone`. */
export interface AimZoneView {
  /** Distance from the centreline to the muzzles (half the beam). */
  side: number;
  /** Distances from the ship's centreline between which a ball can hit a ship abeam. */
  near: number;
  far: number;
  /** Chance 0…1 that a ball hits at each of `CONFIG.aimSteps + 1` distances spread evenly from `near` to `far`. */
  profile: readonly number[];
  /** Half the length along the hull over which guns are spread. */
  halfSpan: number;
  /** Forward drift of the landing zone from the ship's own speed. */
  drift: number;
  /** Extra sideways scatter at the far edge. */
  spread: number;
}

export interface ShipView extends Condition {
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
  hp: number;
  maxHp: number;
  /** Guns per broadside. */
  guns: number;
  /** Broadside readiness: 0 = loaded and ready … 1 = just fired. */
  reload: { port: number; starboard: number };
  aim: AimZoneView;
  /** A live enemy lies inside that side's landing zone right now. */
  inRange: { port: boolean; starboard: boolean };
}

export interface EnemyView extends Condition {
  id: string;
  specId: string;
  name: string;
  /** Nation id (see `world/nations.ts`). */
  nation: string;
  x: number;
  z: number;
  heading: number;
  speed: number;
  roll: number;
  sailLevel: number;
  hp: number;
  maxHp: number;
  /** Seconds since it started sinking; -1 while afloat. */
  sinking: number;
  /** Breaking off the fight. */
  fleeing: boolean;
  /** Metres from the player. */
  distance: number;
  /** Direction from the player as a world angle (same convention as heading). */
  direction: number;
}

export interface BallView {
  id: number;
  owner: Owner;
  x: number;
  y: number;
  z: number;
}

/** One-off things that happened since the previous `view()`: drives smoke, splashes and sound. */
export interface GameEvent {
  type: 'fire' | 'splash' | 'hit' | 'sunk' | 'escaped';
  /** Hull points the hit took off (`hit` events only). */
  amount?: number;
  /** Where the ball struck (`hit` events only). */
  zone?: HitZone;
  owner: Owner;
  x: number;
  y: number;
  z: number;
}

export interface PortView {
  id: string;
  name: string;
  /** Metres to the port's anchorage. */
  distance: number;
  /** Direction to the anchorage as a world angle (same convention as heading). */
  direction: number;
  /** Close and slow enough to dock right now. */
  dockable: boolean;
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
  /** How rough the sea is, 0 (glassy) … 1 (storm): drives the waves, the sky and how the ships handle. */
  seaState: number;
  /** Ambient ships sailing their patrols (distinct from `enemies`, which fight). */
  others: OtherShipView[];
  crew: CrewView[];
  /** Closest port (discovered or not), or null if none is within 1.5 km. */
  nearestPort: PortView | null;
  /** Id of the port the ship is docked at, if any. */
  docked: string | null;
  /** The keel is touching the bottom (shore or shoal). */
  grounded: boolean;
  /** Ids of islands the player has seen. */
  discoveredIslands: readonly string[];
  /** Ids of ports the player has seen. */
  discoveredPorts: readonly string[];
  enemies: readonly EnemyView[];
  balls: readonly BallView[];
  /** Drained by each `view()` call: render once per frame from it. */
  events: readonly GameEvent[];
  /** The player's ship has sunk; restart with `Controls.restart`. */
  sunk: boolean;
  /** Seconds since the player's ship began to sink. */
  sinkTime: number;
  kills: number;
}
