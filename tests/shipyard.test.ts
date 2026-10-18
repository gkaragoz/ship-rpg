import { describe, expect, it } from 'vitest';
import { createGame } from '../src/gameplay';
import { buyShip, offerPrice, repairCost, tradeInValue, whyNot, yardOffers, runYard } from '../src/gameplay/shipyard';
import { newGameState } from '../src/gameplay/state';
import { SHIP_SPECS, getShipSpec } from '../src/ships';
import { PORTS, getPort } from '../src/world';

const spec = (id: string) => getShipSpec(id)!;
const DT = 1 / 60;
const idle = { rudder: 0, sailStep: 0 as const };

describe('the yard', () => {
  it('the best yard sells all sixteen ships, a small one only the small ships', () => {
    expect(yardOffers('redmond')).toHaveLength(SHIP_SPECS.length);
    const small = yardOffers('douwesen-pirates').map((s) => s.id).sort();
    expect(small).toEqual(['barque', 'lugger', 'tartane', 'yacht']);
    for (const p of PORTS) expect(yardOffers(p.id).length, p.id).toBeGreaterThan(0);
  });

  it('prices follow the original table (price × 1000) and the yard pays half for a whole ship, less for a wreck', () => {
    expect(offerPrice(spec('brig'))).toBe(80000);
    const st = newGameState(spec('brig'));
    expect(tradeInValue(st, spec('brig'))).toBe(40000);
    st.ship.hp = 0;
    expect(tradeInValue(st, spec('brig'))).toBe(16000);
  });

  it('repair costs by the damage and nothing for a sound ship', () => {
    const st = newGameState(spec('brig'));
    expect(repairCost(st, spec('brig'))).toBe(0);
    st.ship.hp = spec('brig').stats.hp / 2;
    expect(repairCost(st, spec('brig'))).toBe(10000);
    st.ship.rigging = 0;
    expect(repairCost(st, spec('brig'))).toBe(14000);
  });

  it('refuses what the yard does not build, the same ship, a hold too small, and too little gold', () => {
    const st = newGameState(spec('brig'));
    st.captain.gold = 1e9;
    expect(whyNot(st, spec('brig'), 'douwesen-pirates', spec('galleon'))).toBe('not-sold');
    expect(whyNot(st, spec('brig'), 'redmond', spec('brig'))).toBe('same-ship');
    st.hold = { rum: 1400 };
    expect(whyNot(st, spec('brig'), 'redmond', spec('sloop'))).toBe('hold-too-small');
    st.hold = {};
    st.captain.gold = 1;
    expect(whyNot(st, spec('brig'), 'redmond', spec('galleon'))).toBe('no-gold');
    st.captain.gold = 1e9;
    expect(whyNot(st, spec('brig'), 'redmond', spec('galleon'))).toBeNull();
  });

  it('buying swaps the ship, pays the difference, and trims the crew to fit', () => {
    const st = newGameState(spec('brig'));
    st.captain.gold = 100000;
    const r = buyShip(st, spec('brig'), 'redmond', 'sloop');
    expect(r.ok).toBe(true);
    expect(st.ship).toEqual({ specId: 'sloop', hp: spec('sloop').stats.hp, rigging: 1, flooding: 0, fire: 0 });
    expect(st.captain.gold).toBe(100000 - (offerPrice(spec('sloop')) - 40000));
    expect(st.crew).toBe(spec('sloop').stats.crew);
    expect(buyShip(st, spec('sloop'), 'redmond', 'nope').ok).toBe(false);
  });

  it('runYard needs a port and a command it knows', () => {
    const st = newGameState(spec('brig'));
    expect(runYard(st, spec('brig'), null, { type: 'repair' }, () => undefined).reason).toBe('not-docked');
    expect(runYard(st, spec('brig'), 'redmond', { type: 'repair' }, () => undefined).reason).toBe('nothing-to-repair');
  });
});

describe('in the game', () => {
  const dockedAt = (id: string, setup?: (g: ReturnType<typeof newGameState>) => void) => {
    const state = newGameState(spec('tartane'));
    setup?.(state);
    const game = createGame(state);
    const port = getPort(id)!;
    game.dev.teleportPlayer(port.anchor.x, port.anchor.z);
    game.update(DT, { ...idle, interact: true });
    expect(game.view().docked).toBe(id);
    return game;
  };

  it('buying a ship changes the ship the game sails, keeps the cargo, place and purse', () => {
    const game = dockedAt('redmond', (s) => (s.captain.gold = 100000));
    game.command({ type: 'buy', good: 'rum', qty: 10 });
    const before = game.view();
    const r = game.command({ type: 'buyShip', specId: 'brig' });
    expect(r).toEqual({ ok: true });
    const v = game.view();
    expect(game.spec.id).toBe('brig');
    expect(v.ship).toMatchObject({ specId: 'brig', maxHp: spec('brig').stats.hp, hp: spec('brig').stats.hp, guns: 12 });
    expect(v.cargo).toMatchObject({ used: 10, capacity: spec('brig').stats.hold });
    expect(v.captain.gold).toBeLessThan(before.captain.gold);
    expect(v.company.max).toBe(spec('brig').stats.crew);
    expect(v.ship.x).toBe(before.ship.x);
    expect(v.docked).toBe('redmond');
    expect(game.state().ship.specId).toBe('brig');
    for (let i = 0; i < 120; i++) game.update(DT, idle);
    expect(game.view().ship.hp).toBeGreaterThan(0);
  });

  it('an enemy is picked for the new ship, not the old one', () => {
    const game = dockedAt('redmond', (s) => (s.captain.gold = 1e7));
    game.command({ type: 'buyShip', specId: 'battleship' });
    expect(game.view().enemies).toHaveLength(0); // the old ones were picked for a tartane
    game.update(DT, { ...idle, interact: true });
    for (let i = 0; i < 60 * 30; i++) game.update(DT, idle);
    const foe = game.view().enemies[0];
    expect(foe).toBeDefined();
    expect(foe!.name).not.toBe('Barque');
  });

  it('refuses a purchase without gold or at a small yard; nothing changes', () => {
    const game = dockedAt('redmond');
    expect(game.command({ type: 'buyShip', specId: 'battleship' }).reason).toBe('no-gold');
    expect(game.spec.id).toBe('tartane');
    const small = dockedAt('douwesen-pirates', (s) => (s.captain.gold = 1e7));
    expect(small.command({ type: 'buyShip', specId: 'galleon' }).reason).toBe('not-sold');
  });

  it('a paid repair mends the hull and the rigging, and the yard shows its price', () => {
    const game = dockedAt('douwesen', (s) => {
      s.ship.hp = spec('tartane').stats.hp / 2;
      s.ship.rigging = 0.5;
      s.captain.gold = 100000;
    });
    const yard = game.view().port!.shipyard;
    expect(yard.repairCost).toBeGreaterThan(0);
    const gold = game.view().captain.gold;
    expect(game.command({ type: 'repair' })).toEqual({ ok: true });
    const v = game.view();
    expect(v.ship.hp).toBe(spec('tartane').stats.hp);
    expect(v.ship.rigging).toBe(1);
    expect(v.captain.gold).toBe(gold - yard.repairCost);
    expect(game.command({ type: 'repair' }).reason).toBe('nothing-to-repair');
  });

  it('every one of the sixteen ships can be bought and sailed', () => {
    for (const s of SHIP_SPECS) {
      const game = dockedAt('redmond', (st) => ((st.captain.gold = 1e7), (st.crew = 1)));
      if (s.id !== 'tartane') expect(game.command({ type: 'buyShip', specId: s.id }), s.id).toEqual({ ok: true });
      for (let i = 0; i < 30; i++) game.update(DT, idle);
      expect(game.view().ship.specId).toBe(s.id);
      expect(game.view().ship.maxHp).toBe(s.stats.hp);
    }
  });
});
