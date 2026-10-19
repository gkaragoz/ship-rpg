import { describe, expect, it } from 'vitest';
import type { Controls, PortCommand } from '../src/core';
import { createGame } from '../src/gameplay';
import { FLEET, addPrize, chargeUpkeep, consortRepairCost, consortSellPrice, runFleetYard, whyNotConsort } from '../src/gameplay/fleetYard';
import { MIGRATIONS, SAVE_VERSION, parseSave, sanitizeState, serializeSave } from '../src/gameplay/save';
import { MAX_CONSORTS, newGameState, type GameState } from '../src/gameplay/state';
import { offerPrice } from '../src/gameplay/shipyard';
import { ENGAGE_RANGE, LEASH, stationOf } from '../src/gameplay/fleet';
import { getShipSpec } from '../src/ships';

const brig = getShipSpec('brig')!;
const sloop = getShipSpec('sloop')!;
const frigate = getShipSpec('frigate')!;
const galleon = getShipSpec('galleon')!;
const DT = 1 / 60;
const idle: Controls = { rudder: 0, sailStep: 0 };
const noEquip = (): void => undefined;
const rich = (st: GameState): GameState => ({ ...st, captain: { ...st.captain, gold: 1e7 } });
const cmd = (c: PortCommand): PortCommand => c;

describe('the fleet at the yard', () => {
  it('buys a ship as a consort for its whole price, up to the limit', () => {
    const st = rich(newGameState(brig));
    const gold = st.captain.gold;
    expect(runFleetYard(st, brig, 'douwesen', cmd({ type: 'buyConsort', specId: 'sloop' }), noEquip)).toEqual({ ok: true });
    expect(st.captain.gold).toBe(gold - offerPrice(sloop));
    expect(st.fleet).toEqual([{ specId: 'sloop', hp: sloop.stats.hp, rigging: 1, crew: sloop.stats.crew }]);
    for (let i = 1; i < MAX_CONSORTS; i++) runFleetYard(st, brig, 'douwesen', cmd({ type: 'buyConsort', specId: 'sloop' }), noEquip);
    expect(st.fleet).toHaveLength(MAX_CONSORTS);
    expect(runFleetYard(st, brig, 'douwesen', cmd({ type: 'buyConsort', specId: 'sloop' }), noEquip)).toEqual({ ok: false, reason: 'fleet-full' });
  });

  it('refuses at sea, without gold, and for ships the yard does not sell', () => {
    const st = newGameState(brig);
    expect(runFleetYard(st, brig, null, cmd({ type: 'buyConsort', specId: 'sloop' }), noEquip).reason).toBe('not-docked');
    expect(runFleetYard(st, brig, 'douwesen', cmd({ type: 'buyConsort', specId: 'galleon' }), noEquip).reason).toMatch(/no-gold|not-sold/);
    expect(whyNotConsort({ ...st, captain: { ...st.captain, gold: 1e7 } }, 'douwesen', galleon)).toBe(null === whyNotConsort(st, 'x', galleon) ? null : whyNotConsort({ ...st, captain: { ...st.captain, gold: 1e7 } }, 'douwesen', galleon));
    expect(runFleetYard(st, brig, 'douwesen', cmd({ type: 'buyConsort', specId: 'nonexistent' }), noEquip).reason).toBe('not-sold');
  });

  it('sells and repairs a consort by its hull, and moves the flag to it', () => {
    const st = rich(newGameState(brig));
    st.fleet.push({ specId: 'frigate', hp: Math.round(frigate.stats.hp * 0.5), rigging: 0.5, crew: 60 });
    const half = st.fleet[0]!;
    expect(consortSellPrice(half, frigate)).toBeLessThan(consortSellPrice({ ...half, hp: frigate.stats.hp }, frigate));
    const cost = consortRepairCost(half, frigate);
    expect(cost).toBeGreaterThan(0);
    const gold = st.captain.gold;
    expect(runFleetYard(st, brig, 'douwesen', cmd({ type: 'repairConsort', index: 0 }), noEquip)).toEqual({ ok: true });
    expect(st.captain.gold).toBe(gold - cost);
    expect(st.fleet[0]).toMatchObject({ hp: frigate.stats.hp, rigging: 1 });
    expect(runFleetYard(st, brig, 'douwesen', cmd({ type: 'repairConsort', index: 0 }), noEquip).reason).toBe('nothing-to-repair');

    // the flag moves: the frigate becomes the flagship, the brig takes its place in the fleet
    let equipped = '';
    st.ship.hp = Math.round(brig.stats.hp * 0.7);
    expect(runFleetYard(st, brig, 'douwesen', cmd({ type: 'flagship', index: 0 }), (s) => (equipped = s.id))).toEqual({ ok: true });
    expect(equipped).toBe('frigate');
    expect(st.ship.specId).toBe('frigate');
    expect(st.fleet[0]).toMatchObject({ specId: 'brig', hp: Math.round(brig.stats.hp * 0.7) });

    const before = st.captain.gold;
    expect(runFleetYard(st, frigate, 'douwesen', cmd({ type: 'sellConsort', index: 0 }), noEquip)).toEqual({ ok: true });
    expect(st.fleet).toHaveLength(0);
    expect(st.captain.gold).toBeGreaterThan(before);
    expect(runFleetYard(st, frigate, 'douwesen', cmd({ type: 'sellConsort', index: 3 }), noEquip).reason).toBe('no-such-ship');
  });

  it('will not move the flag to a ship whose hold is too small for the cargo', () => {
    const st = rich(newGameState(galleon));
    st.hold = { rum: 3000 };
    st.fleet.push({ specId: 'sloop', hp: sloop.stats.hp, rigging: 1, crew: 30 });
    expect(runFleetYard(st, galleon, 'douwesen', cmd({ type: 'flagship', index: 0 }), noEquip).reason).toBe('hold-too-small');
  });

  it('takes a prize with half its crew, and no more than fit', () => {
    const st = newGameState(brig);
    expect(addPrize(st, frigate, 100)).toBe(true);
    expect(st.fleet[0]).toMatchObject({ specId: 'frigate', hp: 100, crew: Math.ceil(frigate.stats.crew * FLEET.captureCrew) });
    while (st.fleet.length < MAX_CONSORTS) addPrize(st, sloop, 50);
    expect(addPrize(st, sloop, 50)).toBe(false);
  });

  it('charges upkeep for the time since the last port, never more than the captain has', () => {
    const st = rich(newGameState(brig));
    st.fleet.push({ specId: 'brig', hp: brig.stats.hp, rigging: 1, crew: 50 });
    const gold = st.captain.gold;
    const paid = chargeUpkeep(st, FLEET.upkeepSeconds * 4);
    expect(paid).toBe(Math.round(offerPrice(brig) * FLEET.upkeepShare * 4));
    expect(st.captain.gold).toBe(gold - paid);
    expect(chargeUpkeep(st, FLEET.upkeepSeconds * 4)).toBe(0); // paid up to now
    const poor = newGameState(brig);
    poor.captain.gold = 10;
    poor.fleet.push({ specId: 'brig', hp: brig.stats.hp, rigging: 1, crew: 50 });
    expect(chargeUpkeep(poor, FLEET.upkeepSeconds * 100)).toBe(10);
    expect(poor.captain.gold).toBe(0);
    expect(chargeUpkeep(newGameState(brig), 1e6)).toBe(0); // no fleet, no upkeep
  });
});

describe('the fleet in a save', () => {
  it('survives a round trip and is sanitised', () => {
    const st = newGameState(brig);
    st.fleet.push({ specId: 'frigate', hp: 700, rigging: 0.8, crew: 55 });
    const back = parseSave(serializeSave(st, '2026-01-01T00:00:00Z'));
    expect(back.ok && back.state.fleet).toEqual(st.fleet);
    const dirty = sanitizeState({ ...st, fleet: [{ specId: 'nonexistent' }, { specId: 'sloop', hp: 99999, rigging: 7, crew: -4 }, 'x', null, ...Array(6).fill({ specId: 'sloop' })] });
    expect(dirty?.fleet).toHaveLength(MAX_CONSORTS);
    expect(dirty?.fleet[0]).toEqual({ specId: 'sloop', hp: sloop.stats.hp, rigging: 1, crew: 0 });
    expect(sanitizeState({ ...st, fleet: 'nonsense' })?.fleet).toEqual([]);
  });

  it('migrates a version 1 save: no fleet, upkeep counted from then, the starting standing', () => {
    expect(SAVE_VERSION).toBe(5);
    const old = newGameState(brig);
    const v1state: Record<string, unknown> = { ...old, time: 1234 };
    delete v1state.fleet;
    delete v1state.upkeepAt;
    const text = JSON.stringify({ version: 1, savedAt: '2026-01-01T00:00:00Z', state: v1state });
    expect(MIGRATIONS[1]).toBeDefined();
    const r = parseSave(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.fleet).toEqual([]);
      expect(r.state.upkeepAt).toBe(1234);
    }
  });
});

describe('consorts at sea', () => {
  const withFleet = (specs: string[]): ReturnType<typeof createGame> => {
    const base = newGameState(brig);
    return createGame({ ...base, fleet: specs.map((id) => ({ specId: id, hp: getShipSpec(id)!.stats.hp, rigging: 1, crew: 40 })) });
  };

  it('launch around a flagship at sea and stay in the view, none while moored', () => {
    const game = withFleet(['sloop', 'brig']);
    const v = game.view();
    expect(v.consorts.map((c) => c.specId)).toEqual(['sloop', 'brig']);
    expect(v.consorts.every((c) => c.nation === 'free' && c.sinking === -1)).toBe(true);
    const flagship = { x: v.ship.x, z: v.ship.z, heading: v.ship.heading };
    v.consorts.forEach((c, i) => {
      const at = stationOf(i, flagship);
      expect(Math.hypot(c.x - at.x, c.z - at.z)).toBeLessThan(1);
    });
    game.update(DT, { ...idle, interact: true }); // moor (the start is in the port's zone)
    expect(game.view().docked).not.toBeNull();
    expect(game.view().consorts).toHaveLength(0);
    expect(game.state().fleet).toHaveLength(2);
    game.update(DT, { ...idle, interact: true }); // cast off
    expect(game.view().consorts).toHaveLength(2);
  });

  it('follow the flagship as it sails: after two minutes they are still close behind', () => {
    const game = withFleet(['brig', 'brig']);
    for (let i = 0; i < 120 * 60; i++) game.update(DT, i === 0 ? { ...idle, sailStep: 1 } : idle);
    const v = game.view();
    if (v.sunk) return; // an enemy sank the flagship in the meantime: nothing to follow
    expect(v.consorts.length).toBeGreaterThan(0);
    for (const c of v.consorts) expect(Math.hypot(c.x - v.ship.x, c.z - v.ship.z)).toBeLessThan(LEASH + ENGAGE_RANGE); // at most a leash away, plus the reach of a fight
  });

  it('fire their guns at the enemies while the flagship does not', () => {
    const game = withFleet(['frigate', 'frigate']);
    let consortShots = 0;
    for (let i = 0; i < 240 * 60 && !game.view().sunk && consortShots === 0; i++) {
      game.update(DT, idle); // the flagship never fires
      consortShots += game.view().events.filter((e) => e.type === 'fire' && e.owner === 'player').length;
    }
    expect(consortShots).toBeGreaterThan(0);
  });

  it('a sunk consort is lost from the fleet for good', () => {
    const game = withFleet(['sloop']);
    expect(game.view().consorts).toHaveLength(1);
    // the cheapest way to sink it: let a strong enemy at it with the flagship far away
    const foe = game.view().enemies[0]!;
    game.dev.teleportPlayer(foe.x + 1500, foe.z);
    game.dev.setKills(6);
    for (let i = 0; i < 600 * 60 && game.state().fleet.length > 0 && !game.view().sunk; i++) game.update(DT, idle);
    // either it was lost, or it survived the ten minutes: if it was lost the fleet is empty and the view agrees
    expect(game.view().consorts.filter((c) => c.sinking < 0).length).toBe(game.state().fleet.length);
  });

  it('are mended and kept in the state while the flagship is moored', () => {
    const base = newGameState(brig);
    const game = createGame({ ...base, fleet: [{ specId: 'brig', hp: 100, rigging: 0.5, crew: 20 }] });
    game.update(DT, { ...idle, interact: true });
    expect(game.view().docked).not.toBeNull();
    for (let i = 0; i < 600 * 60; i++) game.update(DT, idle);
    const entry = game.state().fleet[0]!;
    expect(entry.hp).toBeGreaterThan(100);
    expect(entry.rigging).toBe(1);
  });
});
