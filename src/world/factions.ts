import { NATIONS } from './nations';

/**
 * Who is at war with whom, and how the captain stands with each flag. The five flags of the original list: four navies
 * and the pirates; `free` is the captain's own flag and nobody's enemy. Data only: `gameplay/reputation.ts` has the rules.
 */
export const NAVIES = ['english', 'french', 'spanish', 'dutch'] as const;

/** The nations each navy is at war with (the relation is symmetrical: see `atWar`). Pirates are at war with everyone. */
const WARS: Readonly<Record<string, readonly string[]>> = {
  english: ['french', 'spanish'],
  french: ['english'],
  spanish: ['english', 'dutch'],
  dutch: ['spanish'],
};

/** Are two flags at war? A nation is never at war with itself, and nobody is at war with the free captain. */
export function atWar(a: string, b: string): boolean {
  if (a === b || a === 'free' || b === 'free') return false;
  if (a === 'pirate' || b === 'pirate') return true;
  return (WARS[a]?.includes(b) ?? false) || (WARS[b]?.includes(a) ?? false);
}

/** The navies at war with `nation`. */
export const enemiesOf = (nation: string): string[] => NAVIES.filter((n) => atWar(n, nation));

/** Reputation runs from -100 (hated) to 100 (a hero); a new captain starts like this: friends, strangers and one old enemy. */
export const REPUTATION = { min: -100, max: 100 } as const;
export const START_REPUTATION: Readonly<Record<string, number>> = { english: 10, dutch: 10, french: 0, spanish: -25, pirate: -10, free: 0 };

/** Every nation id the reputation table holds. */
export const REPUTATION_NATIONS: readonly string[] = NATIONS.map((n) => n.id);
