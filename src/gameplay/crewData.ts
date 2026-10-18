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
