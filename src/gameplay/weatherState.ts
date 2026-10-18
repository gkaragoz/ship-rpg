import { createRng, type WeatherView } from '../core';
import { weatherAt, type Weather, type WeatherOverrides } from '../world';

/** The weather the game is in: the overrides the player set (the simulator), and the lightning that follows. */
export interface WeatherState {
  /** Change some overrides (a field set to `undefined` goes back to the game's own weather); `null` clears them all. */
  patch(change: WeatherOverrides | null): void;
  /** The weather at `time`; rolls lightning around `around` for a step of `dt` seconds. */
  update(time: number, dt: number, around: { x: number; z: number }): Weather;
  /** What render and sound may know about the weather. */
  view(w: Weather): WeatherView;
}

/** Strikes land within this distance of the ship (m), and come this far apart (s) at full lightning. */
const STRIKE_RANGE = 2500;
const STRIKE_GAP = [6, 22] as const;

export function createWeatherState(): WeatherState {
  let overrides: WeatherOverrides = {};
  const rng = createRng(0x1ee7);
  let untilStrike = 10;
  let strikes = 0;
  let strike: WeatherView['strike'] = null;

  return {
    patch(change): void {
      if (change === null) {
        overrides = {};
        return;
      }
      const next: Record<string, unknown> = { ...overrides };
      for (const [key, value] of Object.entries(change)) {
        if (value === undefined) delete next[key];
        else if (key === 'tuning') next.tuning = { ...overrides.tuning, ...(value as object) };
        else next[key] = value;
      }
      overrides = next as WeatherOverrides;
    },
    update(time, dt, around): Weather {
      const w = weatherAt(time, overrides);
      untilStrike -= dt;
      if (w.lightning <= 0) untilStrike = Math.max(untilStrike, 4);
      else if (untilStrike <= 0) {
        const angle = rng() * Math.PI * 2;
        const distance = 300 + rng() * STRIKE_RANGE;
        strike = { id: ++strikes, x: around.x + Math.cos(angle) * distance, z: around.z + Math.sin(angle) * distance, power: 0.5 + 0.5 * rng() };
        untilStrike = (STRIKE_GAP[0] + rng() * (STRIKE_GAP[1] - STRIKE_GAP[0])) / Math.max(w.lightning, 0.1);
      }
      return w;
    },
    view: (w) => ({ cloud: w.cloud, fog: w.fog, rain: w.rain, lightning: w.lightning, tuning: w.tuning, strike }),
  };
}
