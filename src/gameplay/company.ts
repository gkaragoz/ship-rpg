import { clamp, type HitZone } from '../core';
import { COMBAT } from './combat';
import { reloadBonus } from './progression';

/** The ship's company: how many sailors man the guns, and how fast they die. */
export const COMPANY = {
  /** A short crew reloads slower, down to this fraction of full manning (the broadside then takes 1 / this as long). */
  minFactor: 0.3,
  /** Crew killed by a hit, as a share of (damage ÷ max hull × crew), by where the ball struck. */
  casualty: { hull: 0.6, waterline: 0.6, rigging: 0.15 } as Record<HitZone, number>,
  /** Share of the crew that fights in a boarding party; the rest sail the ship. */
  boardingShare: 0.9,
} as const;

/** How fully manned the ship is, `minFactor` … 1. */
export const crewFactor = (crew: number, max: number): number => (max <= 0 ? 1 : clamp(crew / max, COMPANY.minFactor, 1));

/** Seconds a broadside takes to load: exactly `COMBAT.playerReload` at full crew and level 1. */
export const playerReloadSeconds = (crew: number, max: number, level: number): number =>
  (COMBAT.playerReload / crewFactor(crew, max)) * reloadBonus(level);

/** Crew lost to a hit of `lost` hull points (fractional: the game carries the remainder). */
export const casualties = (lost: number, maxHp: number, crew: number, zone: HitZone): number =>
  maxHp > 0 ? Math.min(crew, (lost / maxHp) * crew * COMPANY.casualty[zone]) : 0;
