/** Trade goods. One unit takes one unit of hold (the `hold` stat of the ship); prices are in gold. */
export interface Good {
  id: string;
  /** Turkish name shown in the UI. */
  name: string;
  /** Typical price per unit; ports multiply it (see `economy.ts`). */
  base: number;
}

export const GOODS: readonly Good[] = [
  { id: 'provisions', name: 'Erzak', base: 8 },
  { id: 'rum', name: 'Rom', base: 20 },
  { id: 'sugar', name: 'Şeker', base: 25 },
  { id: 'cotton', name: 'Pamuk', base: 30 },
  { id: 'tobacco', name: 'Tütün', base: 35 },
  { id: 'coffee', name: 'Kahve', base: 45 },
  { id: 'mahogany', name: 'Maun', base: 55 },
  { id: 'ebony', name: 'Abanoz', base: 75 },
  { id: 'spice', name: 'Baharat', base: 95 },
  { id: 'silk', name: 'İpek', base: 120 },
];

export const getGood = (id: string): Good | undefined => GOODS.find((g) => g.id === id);
