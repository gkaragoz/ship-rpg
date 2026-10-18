import type { CommandResult, Controls, GameView, PortCommand } from '../core';
import type { ShipSpec } from '../ships';
import type { ClockSettings, WeatherOverrides } from '../world';
import type { GameState } from './state';

export interface Game {
  /** The ship the player sails now. */
  readonly spec: ShipSpec;
  /** Buy, sell or hire in the port the ship is moored at (the port panel's buttons). */
  command(cmd: PortCommand): CommandResult;
  /** A copy of everything a save needs (see `GameState`). */
  state(): GameState;
  update(dt: number, controls: Controls): void;
  /** Take over parts of the weather (the weather simulator): see `WeatherOverrides`; `null` gives it all back to the game. */
  setWeather(change: WeatherOverrides | null): void;
  /** The day's clock: how long a day lasts, whether time stands still, and (`hour`) what time it is now. */
  setClock(clock: Partial<Pick<ClockSettings, 'dayMinutes' | 'frozen'>> & { hour?: number }): void;
  /** Snapshot for render and UI. Drains `events`, so call it once per frame. */
  view(): GameView;
  /** Hooks for tests and for poking at the game from the browser console in dev; the game never calls them. */
  readonly dev: {
    /** Set every live enemy's hull to this fraction of its maximum. */
    damageEnemies(fraction: number): void;
    /** Move the player's ship (it keeps heading and speed). */
    teleportPlayer(x: number, z: number): void;
    /** Pretend this many enemies have been sunk this run: changes how many attack at once (the career count is unchanged). */
    setKills(n: number): void;
    /** Set the player's rigging health, 0…1. */
    setRigging(fraction: number): void;
    /** Set the player's flooding and fire, 0…1. */
    setAffliction(flooding: number, fire: number): void;
    /** Set the captain's gold, the crew count, or add experience. */
    setGold(n: number): void;
    setCrew(n: number): void;
    addXp(n: number): void;
    /** Force the sea state, 0 (glassy) … 1 (storm); `null` returns to the weather. */
    setSea(state: number | null): void;
  };
}
