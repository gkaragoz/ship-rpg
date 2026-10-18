import type { CommandResult, MarketLineView, PortCommand, PortServicesView } from '../core';
import type { ShipSpec } from '../ships';
import { GOODS, TRADE, getGood, portMultiplier } from '../world';
import { shipyardView } from './shipyard';
import { holdUsed, type GameState } from './state';

/** Price pressure of a good in a port now: what trading left, faded by the time since. */
export function pressureNow(st: GameState, portId: string, goodId: string, time: number): number {
  const m = st.market[portId]?.[goodId];
  return m ? m.p * 0.5 ** (Math.max(0, time - m.t) / TRADE.halfLife) : 0;
}

/** The mid price of a good in a port now (before the spread). */
export function midPrice(st: GameState, portId: string, goodId: string, time: number): number {
  const base = getGood(goodId)?.base ?? 0;
  return base * portMultiplier(portId, goodId) * (1 + pressureNow(st, portId, goodId, time));
}

/** The price per unit paid for `qty` units (buying) or received (selling): the spread applies and the price moves as you trade. */
export function tradePrice(st: GameState, portId: string, goodId: string, qty: number, side: 'buy' | 'sell', time: number): number {
  const p = pressureNow(st, portId, goodId, time);
  const sign = side === 'buy' ? 1 : -1;
  const avg = 1 + p + (sign * qty) / (2 * TRADE.depth); // the mean of the price before and after the trade
  const mid = (getGood(goodId)?.base ?? 0) * portMultiplier(portId, goodId) * Math.max(0.1, avg);
  return mid * (1 + sign * TRADE.spread);
}

const clampPressure = (p: number): number => Math.min(TRADE.pressureMax, Math.max(TRADE.pressureMin, p));

function nudge(st: GameState, portId: string, goodId: string, delta: number, time: number): void {
  const p = pressureNow(st, portId, goodId, time);
  const market = (st.market[portId] ??= {});
  market[goodId] = { p: clampPressure(p + delta), t: time };
}

const fail = (reason: string): CommandResult => ({ ok: false, reason });
const OK: CommandResult = { ok: true };

/** Carry out a port command on the run's state; `portId` is where the ship is moored (null at sea: nothing is possible). */
export function runCommand(st: GameState, spec: ShipSpec, portId: string | null, time: number, cmd: PortCommand): CommandResult {
  if (!portId) return fail('not-docked');
  if (cmd.type === 'buyShip' || cmd.type === 'repair') return fail('bad-qty'); // the game handles these: they change the ship itself
  const qty = Math.floor(cmd.qty);
  if (!(qty >= 1)) return fail('bad-qty');
  switch (cmd.type) {
    case 'buy': {
      if (!getGood(cmd.good)) return fail('bad-good');
      if (holdUsed(st.hold) + qty > spec.stats.hold) return fail('no-space');
      const cost = Math.ceil(tradePrice(st, portId, cmd.good, qty, 'buy', time) * qty);
      if (cost > st.captain.gold) return fail('no-gold');
      st.captain.gold -= cost;
      st.hold[cmd.good] = (st.hold[cmd.good] ?? 0) + qty;
      nudge(st, portId, cmd.good, qty / TRADE.depth, time);
      return OK;
    }
    case 'sell': {
      if (!getGood(cmd.good)) return fail('bad-good');
      if ((st.hold[cmd.good] ?? 0) < qty) return fail('no-stock');
      st.captain.gold += Math.floor(tradePrice(st, portId, cmd.good, qty, 'sell', time) * qty);
      st.hold[cmd.good] = (st.hold[cmd.good] ?? 0) - qty;
      if (st.hold[cmd.good] === 0) delete st.hold[cmd.good];
      nudge(st, portId, cmd.good, -qty / TRADE.depth, time);
      return OK;
    }
    case 'hire': {
      const room = spec.stats.crew - st.crew;
      if (room < 1) return fail('crew-full');
      const hired = Math.min(qty, room); // asking for more than fits signs on as many as fit
      const cost = hired * TRADE.hirePrice;
      if (cost > st.captain.gold) return fail('no-gold');
      st.captain.gold -= cost;
      st.crew += hired;
      return OK;
    }
    case 'discharge': {
      if (qty > st.crew - 1) return fail('no-crew'); // somebody has to sail her
      st.crew -= qty;
      return OK;
    }
  }
}

/** The market and tavern of a port as the panel shows them. */
export function servicesView(st: GameState, spec: ShipSpec, portId: string, time: number): PortServicesView {
  const market: MarketLineView[] = GOODS.map((g) => ({
    good: g.id,
    buy: tradePrice(st, portId, g.id, 1, 'buy', time),
    sell: tradePrice(st, portId, g.id, 1, 'sell', time),
    trend: midPrice(st, portId, g.id, time) / g.base,
    held: st.hold[g.id] ?? 0,
  }));
  return { portId, market, hirePrice: TRADE.hirePrice, room: Math.max(0, spec.stats.crew - st.crew), shipyard: shipyardView(st, spec, portId) };
}
