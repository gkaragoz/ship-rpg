import { clamp } from '../core';
import { NEUTRAL_TUNING, seaStateAt, type SeaTuning } from './sea';
import { windAt } from './wind';

/**
 * The weather simulator's handles. Every field left out is the game's own weather (the wind of `windAt`, the sea
 * state that wind and storm cells build, rain and lightning that follow a rough sea, the sky as the sea state paints it);
 * a field set takes over that part of the weather.
 */
export interface WeatherOverrides {
  /** m/s. */
  windSpeed?: number;
  /** Where the wind comes from, in the world's heading convention (see `core/views`). */
  windFrom?: number;
  /** 0 glassy … 1 storm. */
  seaState?: number;
  /** Cloud cover 0 … 1, and the thickness of the haze 0 (clear) … 1 (thick). */
  cloud?: number;
  fog?: number;
  /** Rain 0 … 1, and lightning (strikes per minute scale) 0 … 1. */
  rain?: number;
  lightning?: number;
  tuning?: Partial<SeaTuning>;
}

/** The weather at a moment: what is overridden is exactly as set, the rest is the game's. */
export interface Weather {
  windSpeed: number;
  windFrom: number;
  seaState: number;
  /** null: the sky's own for this sea state. */
  cloud: number | null;
  fog: number | null;
  rain: number;
  lightning: number;
  tuning: SeaTuning;
}

const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Rain and lightning of the game's own weather: none until the sea is heavy, then more as the storm builds. */
export const autoRain = (seaState: number): number => smoothstep(0.62, 0.95, seaState) * 0.9;
export const autoLightning = (seaState: number): number => smoothstep(0.82, 1, seaState) * 0.6;

export function weatherAt(time: number, o: WeatherOverrides = {}): Weather {
  const wind = windAt(time);
  const windSpeed = o.windSpeed ?? wind.speed;
  const seaState = clamp(o.seaState ?? seaStateAt(time, windSpeed), 0, 1);
  return {
    windSpeed,
    windFrom: o.windFrom ?? wind.from,
    seaState,
    cloud: o.cloud === undefined ? null : clamp(o.cloud, 0, 1),
    fog: o.fog === undefined ? null : clamp(o.fog, 0, 1),
    rain: clamp(o.rain ?? autoRain(seaState), 0, 1),
    lightning: clamp(o.lightning ?? autoLightning(seaState), 0, 1),
    tuning: {
      amp: o.tuning?.amp ?? NEUTRAL_TUNING.amp,
      length: o.tuning?.length ?? NEUTRAL_TUNING.length,
      chop: o.tuning?.chop ?? NEUTRAL_TUNING.chop,
      speed: o.tuning?.speed ?? NEUTRAL_TUNING.speed,
    },
  };
}

/** Named weathers for the simulator's quick buttons. */
export const WEATHER_PRESETS: Readonly<Record<string, WeatherOverrides>> = {
  'Durgun': { windSpeed: 3, seaState: 0.05, cloud: 0.15, fog: 0, rain: 0, lightning: 0 },
  'Güzel gün': { windSpeed: 9, seaState: 0.35, cloud: 0.3, fog: 0, rain: 0, lightning: 0 },
  'Bulutlu': { windSpeed: 11, seaState: 0.55, cloud: 0.8, fog: 0.15, rain: 0, lightning: 0 },
  'Yağmurlu': { windSpeed: 12, seaState: 0.7, cloud: 0.95, fog: 0.35, rain: 0.6, lightning: 0 },
  'Fırtına': { windSpeed: 17, seaState: 1, cloud: 1, fog: 0.25, rain: 0.9, lightning: 0.6 },
  'Kasırga': { windSpeed: 25, seaState: 1, cloud: 1, fog: 0.5, rain: 1, lightning: 1, tuning: { amp: 1.6, chop: 1.3, speed: 1.2 } },
};
