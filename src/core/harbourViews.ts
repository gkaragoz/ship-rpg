/** What the port panel shows and asks for: the market, the shipyard and the fleet, the errands, and the commands. */

/** One line of a port's market. */
export interface MarketLineView {
  good: string;
  /** Gold per unit to buy and to sell now. */
  buy: number;
  sell: number;
  /** Price now against the good's base price: above 1 is dear. */
  trend: number;
  /** Units in the hold. */
  held: number;
}

/** A ship the yard sells. */
export interface ShipOfferView {
  specId: string;
  name: string;
  /** Price in gold, and what is left to pay after the yard buys the ship you sail. */
  price: number;
  net: number;
  hp: number;
  speed: number;
  turn: number;
  hold: number;
  crew: number;
  cannons: number;
  /** Sailors who would have to leave: the new ship's company is smaller than the crew aboard. */
  trim: number;
  /** This is the ship you sail. */
  current: boolean;
  /** Why it cannot be bought now: not-sold, same-ship, hold-too-small or no-gold. */
  reason?: string;
  /** Why it cannot join the fleet instead: not-sold, fleet-full or no-gold. */
  consortReason?: string;
}

/** A ship of the fleet, as the port panel lists it. */
export interface FleetShipView {
  index: number;
  specId: string;
  name: string;
  hp: number;
  maxHp: number;
  rigging: number;
  crew: number;
  maxCrew: number;
  /** Gold for a full repair, and what the yard pays for it. */
  repairCost: number;
  sellPrice: number;
}

/** An errand on the tavern's board. */
export interface QuestOfferView {
  id: string;
  kind: 'delivery' | 'courier' | 'hunt';
  title: string;
  reward: number;
  /** The nation whose standing it raises. */
  repNation: string;
  /** Courier errands: seconds allowed from now. */
  deadline?: number;
}

/** An errand the captain carries. */
export interface QuestView {
  id: string;
  kind: 'delivery' | 'courier' | 'hunt';
  title: string;
  reward: number;
  /** Where it stands ("ambarda 12/30", "1/3", "84 sn kaldı"). */
  progress: string;
  /** Everything but getting there is done. */
  ready: boolean;
  from: string;
  to: string;
}

export interface ShipyardView {
  /** What the yard pays for your ship now, and a full repair of it. */
  tradeIn: number;
  repairCost: number;
  offers: readonly ShipOfferView[];
  /** The consorts, and how many more the fleet has room for. */
  fleet: readonly FleetShipView[];
  fleetRoom: number;
}

/** What the docked port offers (the port panel's tabs). */
export interface PortServicesView {
  portId: string;
  market: readonly MarketLineView[];
  /** Gold to sign on a sailor, and how many the ship has room for. */
  hirePrice: number;
  room: number;
  shipyard: ShipyardView;
  /** The tavern's board and the errands carried. */
  quests: { offers: readonly QuestOfferView[]; active: readonly QuestView[]; room: number };
}

/** What the port panel asks the game to do. */
export type PortCommand =
  | { type: 'buy' | 'sell'; good: string; qty: number }
  | { type: 'hire' | 'discharge'; qty: number }
  | { type: 'buyShip'; specId: string }
  | { type: 'repair' }
  | { type: 'acceptQuest' | 'abandonQuest'; id: string }
  | { type: 'buyConsort'; specId: string }
  | { type: 'sellConsort' | 'repairConsort' | 'flagship'; index: number };

/** `reason` is a code the UI words: not-docked, bad-qty, bad-good, no-gold, no-space, no-stock, crew-full, no-crew, not-sold, same-ship, hold-too-small, nothing-to-repair, fleet-full, no-such-ship, quests-full, no-such-quest. */
export interface CommandResult {
  ok: boolean;
  reason?: string;
}
