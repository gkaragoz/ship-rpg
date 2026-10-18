/**
 * Crew tuning. Palette sizes mirror public/models/crew/crew.json (tests/crew.test.ts checks they
 * match); the colours themselves stay in that file and are applied by the renderer.
 */
export const CREW_PALETTE_SIZES = { skin: 5, shirt: 8, pants: 5, hair: 6, hat: 4 } as const;

/** Body types in the crew asset: 0-2 male, 3-5 female. */
export const CREW_VARIANTS = 6;
export const FIRST_FEMALE_VARIANT = 3;

/** Match the authored Walk (~1.4 m/s) and Run (~3.6 m/s) clips so feet do not slide. */
export const CREW_SPEED = { walk: 1.4, run: 3.6 } as const;

export const CREW = {
  /** Collision radius of a sailor against the rail and deck props, metres. */
  bodyRadius: 0.22,
  /** Turn rate while walking, rad/s. */
  turnRate: 6,
  /** Seconds standing between walks. */
  idle: [1.5, 5] as const,
  /** Chance that a trip is a run. */
  runChance: 0.15,
  /** Seconds blocked before choosing a new target. */
  stuckAfter: 0.6,
  /** Target distance range, metres. */
  tripLength: [1.2, 8] as const,
  minCount: 3,
  maxCount: 10,
} as const;

/** Timings of the crew's visible work (seconds, metres): all of it is for show. */
export const JOBS = {
  /** Masts that get hands when the sails change. */
  maxMasts: 3,
  /** Share of the mast height a climber goes up (capped at `climbMax`, so the tall ships stay watchable). */
  climbTop: 0.45,
  climbMax: 9,
  /** Seconds up (and down), and aloft. */
  climbTime: 3.2,
  aloftTime: 2.6,
  haulTime: 4.2,
  /** Seconds between two sail jobs. */
  sailCooldown: 6,
  /** Gunners sent to a side that fires, the time they stand at the shot, and the longest they load. */
  gunners: 3,
  fireTime: 0.7,
  maxLoad: 8,
} as const;
