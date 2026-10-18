import { clamp } from '../core';

/**
 * The time of day. The game's own time (seconds) maps to an hour 0…24 through a clock: a day lasts `dayMinutes` of
 * play, the clock starts at `startHour`, and it can be frozen. A pure function of the game time, like the wind.
 */
export interface ClockSettings {
  /** Minutes of play one day (24 hours) lasts. */
  dayMinutes: number;
  /** The hour at game time 0. */
  startHour: number;
  /** Stand still at `startHour`. */
  frozen: boolean;
}

export const DEFAULT_CLOCK: ClockSettings = { dayMinutes: 24, startHour: 9, frozen: false };

/** The hour of the day (0 ≤ h < 24) at a game time in seconds. */
export function hourAt(time: number, clock: ClockSettings = DEFAULT_CLOCK): number {
  const hours = clock.frozen ? clock.startHour : clock.startHour + (time / (clock.dayMinutes * 60)) * 24;
  return ((hours % 24) + 24) % 24;
}

/** A `startHour` that makes it `hour` at game time `time`. */
export function startHourFor(hour: number, time: number, clock: ClockSettings): number {
  if (clock.frozen) return ((hour % 24) + 24) % 24;
  return (((hour - (time / (clock.dayMinutes * 60)) * 24) % 24) + 24) % 24;
}

export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';

export interface SunState {
  hour: number;
  /** Unit vectors from the ship towards the sun and the moon (x east, y up, z south). */
  sun: readonly [number, number, number];
  moon: readonly [number, number, number];
  /** Height of the sun above the horizon, radians (negative at night). */
  elevation: number;
  /** 0 in the dark … 1 in full daylight (a smooth step across the twilight). */
  daylight: number;
  /** 1 when the sun is at the horizon, falling to 0 as it climbs or sinks: the orange hours. */
  twilight: number;
  phase: DayPhase;
}

/** Where the sun stands: a northern latitude and a summer-ish sun (declination), so days are a little longer than nights. */
const LATITUDE = (45 * Math.PI) / 180;
const DECLINATION = (12 * Math.PI) / 180;

const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The sun and moon at an hour. The sun rises in the east, stands in the south at noon and sets in the west. */
export function sunState(hour: number): SunState {
  const h = ((hour - 12) / 12) * Math.PI; // hour angle: 0 at noon, positive in the afternoon
  const east = -Math.cos(DECLINATION) * Math.sin(h);
  const up = Math.sin(LATITUDE) * Math.sin(DECLINATION) + Math.cos(LATITUDE) * Math.cos(DECLINATION) * Math.cos(h);
  const north = Math.cos(LATITUDE) * Math.sin(DECLINATION) - Math.sin(LATITUDE) * Math.cos(DECLINATION) * Math.cos(h);
  const sun = [east, up, -north] as const; // z points south in this world
  const elevation = Math.asin(clamp(up, -1, 1));
  const daylight = smoothstep(-0.12, 0.25, up);
  const twilight = clamp(1 - Math.abs(elevation) / 0.22, 0, 1);
  const phase: DayPhase = daylight < 0.04 ? 'night' : twilight > 0.35 ? (hour < 12 ? 'dawn' : 'dusk') : 'day';
  // The moon rides opposite the sun, a little off the ecliptic so it is not always straight under it.
  const moon = norm([-east + 0.12, -up + 0.1, north * -1 + 0.05]);
  return { hour, sun, moon, elevation, daylight, twilight, phase };
}

function norm(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** "09:41" for an hour. */
export function formatHour(hour: number): string {
  const total = Math.floor(((hour % 24) + 24) % 24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Hours (0 ≤ h < 24) of the named parts of the day, for the quick-set buttons. */
export const HOUR_PRESETS = { dawn: 5.75, morning: 9, noon: 12, dusk: 18.4, night: 0 } as const;
