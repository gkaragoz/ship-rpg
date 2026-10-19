import type { CrewAnim, CrewLook } from '../core';
import { CREW_PALETTE_SIZES, FIRST_FEMALE_VARIANT } from './crewData';
import type { Rng } from './rng';

/** The data of a deck sailor and of the job he is on (see `crew.ts` for what they do). */

export type JobKind = 'helm' | 'haul' | 'climb' | 'gun';
/** `go`: walking to the spot; `work`: at it (the climb's way up); `top`: aloft; `down`: the way back; `fire`/`load`: a gun's two stages. */
export type Stage = 'go' | 'work' | 'top' | 'down' | 'fire' | 'load';

export interface Job {
  kind: JobKind;
  stage: Stage;
  /** Where it is done (ship-local) and what the sailor faces there. */
  x: number;
  z: number;
  faceX: number;
  faceZ: number;
  /** Climbing: how high above the deck. */
  top: number;
  /** Seconds left in this stage. */
  left: number;
  /** Seconds a gun stays loading (after the shot). */
  load: number;
}

export interface Sailor {
  id: number;
  x: number;
  z: number;
  heading: number;
  anim: CrewAnim;
  speed: number;
  moving: boolean;
  timer: number;
  tx: number;
  tz: number;
  blocked: number;
  look: CrewLook;
  job: Job | null;
  /** Seconds in the current animation (drives the procedural poses) and its 0…1 or −1…1 parameter. */
  clock: number;
  lean: number;
  /** Height above the deck while climbing. */
  lift: number;
}

export function makeLook(rng: Rng, variant: number): CrewLook {
  const female = variant >= FIRST_FEMALE_VARIANT;
  const hairStyle: CrewLook['hairStyle'] = female ? (rng.chance(0.65) ? 'long' : 'short') : rng.chance(0.75) ? 'short' : 'none';
  return {
    variant,
    skin: rng.int(CREW_PALETTE_SIZES.skin),
    shirt: rng.int(CREW_PALETTE_SIZES.shirt),
    pants: rng.int(CREW_PALETTE_SIZES.pants),
    hair: rng.int(CREW_PALETTE_SIZES.hair),
    hat: rng.int(CREW_PALETTE_SIZES.hat),
    hairStyle,
    hatStyle: rng.pick(['wide', 'bandana', 'cap', 'none'] as const),
    beard: !female && rng.chance(0.45),
  };
}
