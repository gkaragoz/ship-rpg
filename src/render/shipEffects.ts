import type { GameView } from '../core';
import type { Effects } from './effects';

/** A ship's model size, as the effects need it. */
interface Sized {
  dims: { length: number };
}

/** Ships throw spray from their bows (more in a rough sea) and burning ones smoke on their decks. */
export function emitShipEffects(effects: Effects, view: GameView, player: Sized | null, actors: ReadonlyMap<string, Sized>, dt: number): void {
  const { ship } = view;
  const spray = (st: { x: number; z: number; heading: number; speed: number; heave: number }, length: number): void => {
    const dx = Math.cos(st.heading);
    const dz = -Math.sin(st.heading);
    const power = Math.min(Math.abs(st.speed) / 8, 1) ** 1.5 * (0.25 + 0.9 * view.seaState);
    effects.spray(st.x + dx * length * 0.45, st.heave + 0.6, st.z + dz * length * 0.45, dx, dz, power, dt);
  };
  if (player && !view.sunk && !view.docked) spray(ship, player.dims.length);
  if (player && ship.fire > 0 && !view.sunk) effects.burn(ship.x, player.dims.length * 0.1, ship.z, ship.fire, dt);
  for (const e of view.enemies) {
    const a = actors.get(e.id);
    if (!a || e.sinking >= 0) continue;
    spray(e, a.dims.length);
    if (e.fire > 0) effects.burn(e.x, a.dims.length * 0.1, e.z, e.fire, dt);
  }
}
