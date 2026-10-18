/** Captain levels: experience from sinking and taking ships. Level 1 changes nothing, so the duel tables stay valid. */
export const PROGRESSION = {
  maxLevel: 10,
  /** Cumulative experience to reach level n is `base × (n − 1)^power`. */
  base: 100,
  power: 1.6,
  /** Experience per point of the enemy's strength (`strength` in enemy.ts), and the bonus for taking a ship by boarding. */
  perStrength: 0.1,
  boardedBonus: 0.5,
  /** Per level above 1: shorter reloads, bigger loot, stronger boarding parties. */
  reloadPerLevel: 0.02,
  lootPerLevel: 0.05,
  boardingPerLevel: 0.03,
} as const;

/** Experience needed to reach `level` (level 1 needs none). */
export const xpToReach = (level: number): number => (level <= 1 ? 0 : Math.round(PROGRESSION.base * (level - 1) ** PROGRESSION.power));

export function levelFor(xp: number): number {
  let level = 1;
  while (level < PROGRESSION.maxLevel && xp >= xpToReach(level + 1)) level++;
  return level;
}

/** Where `xp` stands inside its level: experience earned in it and how much the level spans (0 span at the cap). */
export function levelProgress(xp: number): { level: number; into: number; span: number } {
  const level = levelFor(xp);
  if (level >= PROGRESSION.maxLevel) return { level, into: 0, span: 0 };
  return { level, into: xp - xpToReach(level), span: xpToReach(level + 1) - xpToReach(level) };
}

export const xpForKill = (enemyStrength: number, boarded = false): number =>
  Math.round(enemyStrength * PROGRESSION.perStrength * (boarded ? 1 + PROGRESSION.boardedBonus : 1));

const above = (level: number): number => Math.max(0, level - 1);
export const reloadBonus = (level: number): number => 1 - PROGRESSION.reloadPerLevel * above(level);
export const lootBonus = (level: number): number => 1 + PROGRESSION.lootPerLevel * above(level);
export const boardingBonus = (level: number): number => 1 + PROGRESSION.boardingPerLevel * above(level);
