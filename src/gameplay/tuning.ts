/** Docking needs the ship inside the port's marked entry zone (`PORT_ZONE`) and this slow. */
export const DOCK = { maxSpeed: 2.5 } as const;
/** A replacement comes this many seconds after a kill or an escape. */
export const RESPAWN = 25;
/** Seconds between one enemy arriving and the next of a group. */
export const STAGGER = 12;
/** Fraction of hull strength a moored ship mends per second: slow, so the shipyard's paid repair matters (rigging, leaks and fire are put right quickly: `damage.ts`). */
export const REPAIR_RATE = 0.002;
/** How fast the player lays the guns up or down (rad/s). */
export const ELEVATE_RATE = 0.06;

