/** Global, game-logic-independent constants. */
export const CONFIG = {
  /** Fixed simulation step in seconds. */
  fixedStep: 1 / 60,
  /** Max frame delta clamp in seconds (avoids spiral of death after tab switch). */
  maxFrameDelta: 0.1,
} as const;
