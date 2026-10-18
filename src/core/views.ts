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
}

export interface WindView {
  from: number;
  /** m/s */
  speed: number;
}

export interface ShipView {
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
}

export interface GameView {
  time: number;
  ship: ShipView;
  wind: WindView;
}
