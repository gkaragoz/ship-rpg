/** Global, game-logic-independent constants. */
export const CONFIG = {
  /** Fixed simulation step in seconds. */
  fixedStep: 1 / 60,
  /** Max frame delta clamp in seconds (avoids spiral of death after tab switch). */
  maxFrameDelta: 0.1,
  /** Seconds a sinking ship takes to go down (gameplay removes it, render animates it). */
  sinkSeconds: 8,
} as const;
