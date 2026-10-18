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
  /** Lay the guns lower (-1, shorter range) or higher (+1, longer range) while held. */
  elevate?: -1 | 0 | 1;
  /** One-shot: board the crippled enemy alongside. */
  board?: boolean;
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

/** The wind a moving ship feels: the true wind less the ship's own motion. */
export interface ApparentWindView {
  /** Angle between the bow and where the wind seems to come from (+ from port, - from starboard), radians. */
  angle: number;
  /** m/s */
  speed: number;
}

export interface WindView {
  from: number;
  /** m/s */
  speed: number;
}

/** A point on a ball's flight path (world metres). */
export interface ArcPointView {
  x: number;
  y: number;
  z: number;
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

/** How a hull rides the waves: the game's spring model (`gameplay/buoyancy.ts`), which render only draws. */
export interface Attitude {
  /** Height of the hull above the mean sea level (m). */
  heave: number;
  /** Bow-up positive, radians. */
  pitch: number;
  /** Roll the waves give the hull, radians; subtract it from the wind's heel (to starboard positive) when drawing. */
  waveRoll: number;
}

export interface ShipView extends Condition, Attitude {
  /** Which ship spec the player sails now (it changes when a ship is bought). */
  specId: string;
  name: string;
  /** Seconds one broadside takes to reload now (grows when the crew is short). */
  reloadSeconds: number;
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
  /** How high the guns are laid (rad) and the range it gives: the landing point of the middle ball is `arc`'s last point. */
  elevation: number;
  /** The wind the ship feels, and the gust multiplier (0.75 … 1.25) it is sailing in. */
  apparent: ApparentWindView;
  gust: number;
  /** The flight a ball of each broadside will fly now (muzzle to landing), with drag, wind and the ship's own speed. */
  arc: { port: readonly ArcPointView[]; starboard: readonly ArcPointView[] };
  /** A live enemy lies inside that side's landing zone right now. */
  inRange: { port: boolean; starboard: boolean };
}

export interface EnemyView extends Condition, Attitude {
  id: string;
  /** The sailors on its deck, while it is close enough to see them (empty otherwise). */
  crew?: CrewView[];
  apparent: ApparentWindView;
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
  type: 'fire' | 'splash' | 'hit' | 'sunk' | 'escaped' | 'collision' | 'boarded' | 'loot' | 'levelup';
  /** `boarded`: the party won. `loot`: gold taken (`amount` is the goods). `levelup`: the level reached. */
  won?: boolean;
  gold?: number;
  level?: number;
  /** `sunk` events: the length of the ship that went down (m), for the sailors it spills. */
  length?: number;
  /** Hull points the hit took off (`hit` events), or the crew lost (`boarded`). */
  amount?: number;
  /** Where the ball struck (`hit` events only). */
  zone?: HitZone;
  /** `collision` events: the unit normal of the contact (from the first ship to the second) and the closing speed (m/s). */
  nx?: number;
  nz?: number;
  speed?: number;
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
  /** Inside the port's marked entry zone (the ship may still be too fast to enter). */
  inZone: boolean;
}

/** Another ship at sea; kinematic and shown at a distance-dependent level of detail. */
export interface OtherShipView {
  id: number;
  /** The sailors on its deck while it is close (see `EnemyView.crew`). */
  crew?: CrewView[];
  /** Which ship spec (and model) to draw. */
  specId: string;
  /** Nation id of its flag (see `world/nations.ts`); free when absent. */
  nation?: string;
  x: number;
  z: number;
  heading: number;
  sailLevel: number;
  roll: number;
  apparent: ApparentWindView;
}

/** `Idle`, `Walk` and `Run` are authored clips; the others are poses the renderer adds on the idle clip (helm, haul, climb, aloft, load, fire) or whole-body states of a swimmer (`Fly`, `Swim`, `Drown`). */
export type CrewAnim = 'Idle' | 'Walk' | 'Run' | 'Helm' | 'Haul' | 'Climb' | 'Aloft' | 'Load' | 'Fire' | 'Fly' | 'Swim' | 'Drown';

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
  /** Seconds in this animation (the poses' clock) and its parameter: 0…1 progress (climb, fire) or −1…1 (the helm's wheel). */
  clock: number;
  lean: number;
  /** A swimmer's tumble about the sideways and the forward axis (rad); upright when absent. */
  pitch?: number;
  roll?: number;
}

/** The sea's wave tuning (see `world/sea.ts`), as render needs it. */
export interface TuningView {
  amp: number;
  length: number;
  chop: number;
  speed: number;
}

/** The weather beyond wind and sea state (those are `GameView.wind` and `seaState`). */
export interface WeatherView {
  /** Cloud cover and haze 0…1, or null: the sky's own for this sea state. */
  cloud: number | null;
  fog: number | null;
  /** Rain 0…1 and how often lightning strikes 0…1. */
  rain: number;
  lightning: number;
  tuning: TuningView;
  /** The latest lightning strike (a new `id` is a new strike), in world metres. */
  strike: { id: number; x: number; z: number; power: number } | null;
}

/** The captain's purse and standing. */
export interface CaptainView {
  gold: number;
  xp: number;
  /** 1 … max level. */
  level: number;
  /** Experience earned inside this level and the amount this level spans (for a progress bar). */
  xpIntoLevel: number;
  xpForNext: number;
  /** Ships sunk or taken over the whole career (`GameView.kills` is this run's count). */
  kills: number;
}

/** What is in the hold. */
export interface CargoView {
  used: number;
  capacity: number;
  items: readonly { id: string; qty: number }[];
}

/** The ship's company (not the sailors on deck, see `CrewView`). */
export interface CompanyView {
  count: number;
  max: number;
  /** 0…1: how fully manned the ship is; below 1 the guns reload slower. */
  factor: number;
}

/** Whether a crippled enemy lies alongside and could be boarded (`Controls.board`). */
export interface BoardingView {
  available: boolean;
  targetId: string | null;
  /** Chance 0…1 the party wins. */
  odds: number;
  /** Seconds before another try after a failed boarding. */
  cooldown: number;
}

/** One line of a port's market. */
export interface MarketLineView {
  good: string;
  /** Gold per unit to buy and to sell now. */
  buy: number;
  sell: number;
  /** Price now against the good's base price: above 1 is dear. */
  trend: number;
  /** Units in the hold. */
  held: number;
}

/** A ship the yard sells. */
export interface ShipOfferView {
  specId: string;
  name: string;
  /** Price in gold, and what is left to pay after the yard buys the ship you sail. */
  price: number;
  net: number;
  hp: number;
  speed: number;
  turn: number;
  hold: number;
  crew: number;
  cannons: number;
  /** Sailors who would have to leave: the new ship's company is smaller than the crew aboard. */
  trim: number;
  /** This is the ship you sail. */
  current: boolean;
  /** Why it cannot be bought now: not-sold, same-ship, hold-too-small or no-gold. */
  reason?: string;
}

export interface ShipyardView {
  /** What the yard pays for your ship now, and a full repair of it. */
  tradeIn: number;
  repairCost: number;
  offers: readonly ShipOfferView[];
}

/** What the docked port offers (the port panel's tabs). */
export interface PortServicesView {
  portId: string;
  market: readonly MarketLineView[];
  /** Gold to sign on a sailor, and how many the ship has room for. */
  hirePrice: number;
  room: number;
  shipyard: ShipyardView;
}

/** What the port panel asks the game to do. */
export type PortCommand =
  | { type: 'buy' | 'sell'; good: string; qty: number }
  | { type: 'hire' | 'discharge'; qty: number }
  | { type: 'buyShip'; specId: string }
  | { type: 'repair' };

/** `reason` is a code the UI words: not-docked, bad-qty, bad-good, no-gold, no-space, no-stock, crew-full, no-crew, not-sold, same-ship, hold-too-small, nothing-to-repair. */
export interface CommandResult {
  ok: boolean;
  reason?: string;
}

export interface GameView {
  time: number;
  ship: ShipView;
  wind: WindView;
  weather: WeatherView;
  /** The hour of the day, 0 ≤ h < 24: the light, the sky and the lamps follow it (see `world/clock.ts`). */
  hour: number;
  /** How rough the sea is, 0 (glassy) … 1 (storm): drives the waves, the sky, the ships' motion and how they handle. */
  seaState: number;
  /** Ambient ships sailing their patrols (distinct from `enemies`, which fight). */
  others: OtherShipView[];
  crew: CrewView[];
  captain: CaptainView;
  cargo: CargoView;
  company: CompanyView;
  boarding: BoardingView;
  /** The docked port's market and tavern; null at sea. */
  port: PortServicesView | null;
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
