/** The sailors of a ship's deck (and the swimmers): what `render` needs to draw them. */

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
