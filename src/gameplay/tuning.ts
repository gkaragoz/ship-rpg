/** Docking needs the ship this close to the anchorage and this slow. */
export const DOCK = { range: 80, maxSpeed: 2.5 } as const;
/** A replacement comes this many seconds after a kill or an escape. */
export const RESPAWN = 25;
/** Seconds between one enemy arriving and the next of a group. */
export const STAGGER = 12;
/** Fraction of hull strength a moored ship repairs per second. */
export const REPAIR_RATE = 0.02;
/** How fast the player lays the guns up or down (rad/s). */
export const ELEVATE_RATE = 0.06;

