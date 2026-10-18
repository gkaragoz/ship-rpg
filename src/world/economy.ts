/** What each port makes cheap and dear, and what its yard and tavern offer. Prices are `Good.base` × a multiplier. */
export interface PortEconomy {
  /** Goods the port produces: cheap here (multiplier below 1). */
  produces: Readonly<Record<string, number>>;
  /** Goods the port wants: dear here (multiplier above 1). */
  demands: Readonly<Record<string, number>>;
  /** The best ship class its yard builds (1 = battleship … 7 = tartane): it sells every ship of this class or smaller. */
  yardClass: number;
}

/** Everything else costs the base price. */
export const TRADE = {
  /** Spread: buying costs this much above the mid price, selling gets this much below. */
  spread: 0.06,
  /** Units of one good that move its price by 100 %. */
  depth: 20000,
  /** Price pressure keeps within this band and fades by half every this many game seconds. */
  pressureMin: -0.5,
  pressureMax: 1,
  halfLife: 600,
  /** Gold to sign on a sailor. */
  hirePrice: 10,
} as const;

export const PORT_ECONOMY: Readonly<Record<string, PortEconomy>> = {
  redmond: { produces: { provisions: 0.82, cotton: 0.86 }, demands: { silk: 1.2, spice: 1.18, rum: 1.15 }, yardClass: 1 },
  douwesen: { produces: { spice: 0.8, coffee: 0.84 }, demands: { mahogany: 1.2, cotton: 1.16 }, yardClass: 2 },
  'douwesen-pirates': { produces: { rum: 0.8, silk: 0.84 }, demands: { provisions: 1.25, sugar: 1.18 }, yardClass: 6 },
  oxbay: { produces: { mahogany: 0.8, provisions: 0.84 }, demands: { sugar: 1.2, tobacco: 1.2 }, yardClass: 3 },
  greenford: { produces: { sugar: 0.8, rum: 0.84 }, demands: { cotton: 1.18, ebony: 1.2 }, yardClass: 5 },
  'falaise-de-fleur': { produces: { silk: 0.82, coffee: 0.86 }, demands: { rum: 1.22, provisions: 1.18 }, yardClass: 4 },
  conceicao: { produces: { tobacco: 0.8, cotton: 0.84 }, demands: { spice: 1.2, silk: 1.16 }, yardClass: 2 },
  'conceicao-smugglers': { produces: { ebony: 0.82, spice: 0.86 }, demands: { mahogany: 1.2, coffee: 1.18 }, yardClass: 6 },
  'isla-muelle': { produces: { provisions: 0.8, coffee: 0.84 }, demands: { tobacco: 1.22, ebony: 1.16 }, yardClass: 5 },
  'quebradas-costillas': { produces: { ebony: 0.8, mahogany: 0.86 }, demands: { provisions: 1.2, sugar: 1.2 }, yardClass: 2 },
  'khoal-roa': { produces: { spice: 0.78, ebony: 0.86 }, demands: { rum: 1.2, cotton: 1.2 }, yardClass: 5 },
};

/** The mid price multiplier of a good in a port before any trading pressure. */
export function portMultiplier(portId: string, goodId: string): number {
  const e = PORT_ECONOMY[portId];
  return e?.produces[goodId] ?? e?.demands[goodId] ?? 1;
}
