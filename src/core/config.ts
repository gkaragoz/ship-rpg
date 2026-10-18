/** Global, game-logic-independent constants. */
export const CONFIG = {
  /** Fixed simulation step in seconds. */
  fixedStep: 1 / 60,
  /** Max frame delta clamp in seconds (avoids spiral of death after tab switch). */
  maxFrameDelta: 0.1,
  /** Seconds a sinking ship takes to go down (gameplay removes it, render animates it). */
  sinkSeconds: 8,
  /** An enemy that has been farther than this (m) from the player for `giveUpSeconds` gives up; the HUD shows targets out to it. */
  giveUpRange: 1000,
  giveUpSeconds: 20,
} as const;
