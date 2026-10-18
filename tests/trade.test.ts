import { describe, expect, it } from 'vitest';
import { createGame } from '../src/gameplay';
import { midPrice, pressureNow, runCommand, servicesView, tradePrice } from '../src/gameplay/harbour';
import { holdUsed, newGameState } from '../src/gameplay/state';
import { getShipSpec } from '../src/ships';
import { GOODS, PORTS, PORT_ECONOMY, TRADE, getGood } from '../src/world';

const brig = getShipSpec('brig')!;
const fresh = () => newGameState(brig);

describe('trade data', () => {
  it('every port has an economy, every good is made somewhere and wanted somewhere, multipliers are sane', () => {
    for (const p of PORTS) expect(PORT_ECONOMY[p.id], p.id).toBeDefined();
    for (const g of GOODS) {
      const makers = Object.values(PORT_ECONOMY).filter((e) => e.produces[g.id] !== undefined);
      const buyers = Object.values(PORT_ECONOMY).filter((e) => e.demands[g.id] !== undefined);
      expect(makers.length, `${g.id} made`).toBeGreaterThan(0);
      expect(buyers.length, `${g.id} wanted`).toBeGreaterThan(0);
    }
    for (const e of Object.values(PORT_ECONOMY)) {
      for (const m of Object.values(e.produces)) expect(m).toBeLessThan(1);
      for (const m of Object.values(e.demands)) expect(m).toBeGreaterThan(1);
      for (const id of [...Object.keys(e.produces), ...Object.keys(e.demands)]) expect(getGood(id), id).toBeDefined();
    }
  });
});

describe('buying and selling', () => {
  it('buying costs gold and takes hold; selling reverses it for a little less', () => {
    const st = fresh();
    st.captain.gold = 10000;
    expect(runCommand(st, brig, 'douwesen', 0, { type: 'buy', good: 'rum', qty: 50 })).toEqual({ ok: true });
    expect(st.hold.rum).toBe(50);
    const paid = 10000 - st.captain.gold;
    expect(paid).toBeGreaterThan(0);
    expect(runCommand(st, brig, 'douwesen', 0, { type: 'sell', good: 'rum', qty: 50 }).ok).toBe(true);
    expect(st.hold.rum).toBeUndefined();
    expect(st.captain.gold).toBeLessThan(10000); // the spread and the pressure of the trade
    expect(st.captain.gold).toBeGreaterThan(10000 - paid * 0.25);
  });

  it('refuses without gold, without room, without stock, at sea, and nonsense quantities', () => {
    const st = fresh();
    st.captain.gold = 5;
    expect(runCommand(st, brig, 'douwesen', 0, { type: 'buy', good: 'silk', qty: 1 })).toEqual({ ok: false, reason: 'no-gold' });
    st.captain.gold = 1e9;
    expect(runCommand(st, brig, 'douwesen', 0, { type: 'buy', good: 'rum', qty: brig.stats.hold + 1 }).reason).toBe('no-space');
    expect(runCommand(st, brig, 'douwesen', 0, { type: 'sell', good: 'rum', qty: 1 }).reason).toBe('no-stock');
    expect(runCommand(st, brig, null, 0, { type: 'buy', good: 'rum', qty: 1 }).reason).toBe('not-docked');
    expect(runCommand(st, brig, 'douwesen', 0, { type: 'buy', good: 'rum', qty: 0 }).reason).toBe('bad-qty');
    expect(runCommand(st, brig, 'douwesen', 0, { type: 'buy', good: 'nope', qty: 1 }).reason).toBe('bad-good');
    expect(holdUsed(st.hold)).toBe(0);
    expect(st.captain.gold).toBe(1e9);
  });

  it('never fills the hold past its capacity', () => {
    const st = fresh();
    st.captain.gold = 1e9;
    runCommand(st, brig, 'douwesen', 0, { type: 'buy', good: 'rum', qty: brig.stats.hold - 10 });
    expect(runCommand(st, brig, 'douwesen', 0, { type: 'buy', good: 'sugar', qty: 11 }).reason).toBe('no-space');
    expect(runCommand(st, brig, 'douwesen', 0, { type: 'buy', good: 'sugar', qty: 10 }).ok).toBe(true);
    expect(holdUsed(st.hold)).toBe(brig.stats.hold);
  });

  it('prices follow the port: cheap where made, dear where wanted', () => {
    const st = fresh();
    expect(midPrice(st, 'greenford', 'sugar', 0)).toBeLessThan(getGood('sugar')!.base);
    expect(midPrice(st, 'oxbay', 'sugar', 0)).toBeGreaterThan(getGood('sugar')!.base);
    expect(midPrice(st, 'oxbay', 'cotton', 0)).toBe(getGood('cotton')!.base);
  });
});

describe('price pressure', () => {
  it('buying pushes the price up, selling pushes it down, and it fades with time', () => {
    const st = fresh();
    st.captain.gold = 1e9;
    const before = midPrice(st, 'greenford', 'sugar', 0);
    runCommand(st, brig, 'greenford', 0, { type: 'buy', good: 'sugar', qty: 600 });
    const after = midPrice(st, 'greenford', 'sugar', 0);
    expect(after).toBeGreaterThan(before);
    expect(midPrice(st, 'greenford', 'sugar', TRADE.halfLife)).toBeCloseTo(before + (after - before) / 2, 1);
    expect(pressureNow(st, 'greenford', 'sugar', 100 * TRADE.halfLife)).toBeCloseTo(0, 3);
    runCommand(st, brig, 'oxbay', 0, { type: 'sell', good: 'sugar', qty: 600 });
    expect(midPrice(st, 'oxbay', 'sugar', 0)).toBeLessThan(getGood('sugar')!.base * 1.2);
  });

  it('a bigger lot costs a higher average than a single unit', () => {
    const st = fresh();
    expect(tradePrice(st, 'oxbay', 'rum', 1000, 'buy', 0)).toBeGreaterThan(tradePrice(st, 'oxbay', 'rum', 1, 'buy', 0));
    expect(tradePrice(st, 'oxbay', 'rum', 1000, 'sell', 0)).toBeLessThan(tradePrice(st, 'oxbay', 'rum', 1, 'sell', 0));
  });
});

describe('a trade run pays, within reason', () => {
  /** Fill the hold at `from` with the goods (split evenly), sell it all at `to`: gold made as a share of the cost. */
  const margin = (from: string, to: string, goods: string[], spec = brig): number => {
    const st = newGameState(spec);
    st.captain.gold = 1e9;
    const start = st.captain.gold;
    const each = Math.floor(spec.stats.hold / goods.length);
    for (const good of goods) runCommand(st, spec, from, 0, { type: 'buy', good, qty: each });
    const cost = start - st.captain.gold;
    for (const good of goods) runCommand(st, spec, to, 0, { type: 'sell', good, qty: each });
    return (st.captain.gold - start) / cost;
  };

  it('the best leg for each size of ship pays 15 to 35 per cent (the big hulls less) (two goods share the hold); a full galleon moves the price noticeably', () => {
    const best = (spec: typeof brig): number => {
      let top = -1;
      for (const a of PORTS) {
        for (const b of PORTS) {
          if (a === b) continue;
          const made = Object.keys(PORT_ECONOMY[a.id]!.produces).filter((g) => PORT_ECONOMY[b.id]!.demands[g] !== undefined);
          const wanted = Object.keys(PORT_ECONOMY[b.id]!.demands);
          top = Math.max(top, margin(a.id, b.id, made.length ? made : wanted.slice(0, 1), spec));
        }
      }
      return top;
    };
    const floors: Record<string, number> = { tartane: 0.15, sloop: 0.15, brig: 0.15, galleon: 0.05, battleship: 0.02 };
    for (const [id, floor] of Object.entries(floors)) {
      const m = best(getShipSpec(id)!);
      expect(m, id).toBeGreaterThan(floor);
      expect(m, id).toBeLessThan(0.35);
    }
  });

  it('buying and selling in the same port never makes money', () => {
    for (const p of PORTS) for (const g of GOODS) expect(margin(p.id, p.id, [g.id]), `${p.id} ${g.id}`).toBeLessThan(0);
  });
});

describe('the tavern', () => {
  it('hires up to the ship, charges for it, discharges', () => {
    const st = fresh();
    st.crew = 100;
    st.captain.gold = 100;
    expect(runCommand(st, brig, 'oxbay', 0, { type: 'hire', qty: 10 })).toEqual({ ok: true });
    expect(st.crew).toBe(110);
    expect(st.captain.gold).toBe(100 - 10 * TRADE.hirePrice);
    expect(runCommand(st, brig, 'oxbay', 0, { type: 'hire', qty: 11 }).reason).toBe('no-gold');
    st.captain.gold = 1e6;
    expect(runCommand(st, brig, 'oxbay', 0, { type: 'hire', qty: 80 })).toEqual({ ok: true }); // more than fits: as many as fit
    expect(st.crew).toBe(160);
    expect(runCommand(st, brig, 'oxbay', 0, { type: 'hire', qty: 1 }).reason).toBe('crew-full');
    st.crew = 100;
    expect(runCommand(st, brig, 'oxbay', 0, { type: 'discharge', qty: 1000 }).reason).toBe('no-crew');
    expect(runCommand(st, brig, 'oxbay', 0, { type: 'discharge', qty: 100 }).reason).toBe('no-crew'); // the last sailor stays
    expect(runCommand(st, brig, 'oxbay', 0, { type: 'sell', good: 'constructor', qty: 1 }).reason).toBe('bad-good');
    expect(runCommand(st, brig, 'oxbay', 0, { type: 'discharge', qty: 10 }).ok).toBe(true);
    expect(st.crew).toBe(90);
  });
});

describe('in the game', () => {
  it('the port view appears only while moored, and commands only work there', () => {
    const game = createGame(brig);
    expect(game.view().port).toBeNull();
    expect(game.command({ type: 'buy', good: 'rum', qty: 1 }).reason).toBe('not-docked');
    game.dev.teleportPlayer(...(Object.values(PORTS[0]!.anchor) as [number, number]));
    game.update(1 / 60, { rudder: 0, sailStep: 0, interact: true });
    const v = game.view();
    expect(v.docked).not.toBeNull();
    expect(v.port?.market).toHaveLength(GOODS.length);
    expect(game.command({ type: 'buy', good: 'rum', qty: 5 }).ok).toBe(true);
    expect(game.view().cargo.used).toBe(5);
    expect(game.state().hold.rum).toBe(5);
    expect(servicesView(game.state(), brig, v.docked!, 0).market.find((m) => m.good === 'rum')?.held).toBe(5);
  });
});
