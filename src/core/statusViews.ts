/** The weather and the captain's standing, hold, company and boarding chance, as `render` and `ui` read them. */

/** The sea's wave tuning (see `world/sea.ts`), as render needs it. */
export interface TuningView {
  amp: number;
  length: number;
  chop: number;
  speed: number;
}

/** The weather beyond wind and sea state (those are `GameView.wind` and `seaState`). */
export interface WeatherView {
  /** Cloud cover and haze 0…1, or null: the sky's own for this sea state. */
  cloud: number | null;
  fog: number | null;
  /** Rain 0…1 and how often lightning strikes 0…1. */
  rain: number;
  lightning: number;
  tuning: TuningView;
  /** The latest lightning strike (a new `id` is a new strike), in world metres. */
  strike: { id: number; x: number; z: number; power: number } | null;
}

/** The captain's purse and standing. */
export interface CaptainView {
  gold: number;
  xp: number;
  /** 1 … max level. */
  level: number;
  /** Experience earned inside this level and the amount this level spans (for a progress bar). */
  xpIntoLevel: number;
  xpForNext: number;
  /** Ships sunk or taken over the whole career (`GameView.kills` is this run's count). */
  kills: number;
}

/** What is in the hold. */
export interface CargoView {
  used: number;
  capacity: number;
  items: readonly { id: string; qty: number }[];
}

/** The ship's company (not the sailors on deck, see `CrewView`). */
export interface CompanyView {
  count: number;
  max: number;
  /** 0…1: how fully manned the ship is; below 1 the guns reload slower. */
  factor: number;
}

/** Whether a crippled enemy lies alongside and could be boarded (`Controls.board`). */
export interface BoardingView {
  available: boolean;
  targetId: string | null;
  /** Chance 0…1 the party wins. */
  odds: number;
  /** Seconds before another try after a failed boarding. */
  cooldown: number;
}
