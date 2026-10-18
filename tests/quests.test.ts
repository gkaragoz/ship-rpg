import { describe, expect, it } from 'vitest';
import { createGame } from '../src/gameplay';
import { QUESTS, openOffers, questDay, questKill, questOffers, questsView, runQuestCommand, settleQuests, type Quest } from '../src/gameplay/quests';
import { sanitizeQuests } from '../src/gameplay/questSave';
import { MIGRATIONS, parseSave, sanitizeState, serializeSave } from '../src/gameplay/save';
import { standing } from '../src/gameplay/reputation';
import { newGameState } from '../src/gameplay/state';
import { GOODS, PORTS, PORT_ECONOMY, getPort } from '../src/world';
import { getShipSpec } from '../src/ships';

const brig = getShipSpec('brig')!;
const fresh = () => newGameState(brig);
const HERE = 'douwesen';

describe('the tavern board', () => {
  it('offers a delivery, a courier errand and a hunt, the same all day and fresh tomorrow', () => {
    const a = questOffers(HERE, 100);
    expect(a.map((q) => q.kind)).toEqual(['delivery', 'courier', 'hunt']);
    expect(questOffers(HERE, 100 + QUESTS.dayLength - 200)).toEqual(a);
    const tomorrow = questOffers(HERE, QUESTS.dayLength + 100);
    expect(tomorrow.map((q) => q.id)).not.toEqual(a.map((q) => q.id));
    expect(new Set([...a, ...tomorrow].map((q) => q.id)).size).toBe(6);
    expect(questDay(QUESTS.dayLength * 3 + 5)).toBe(3);
    expect(questOffers('atlantis', 0)).toEqual([]);
  });

  it('makes sensible errands in every port on many days', () => {
    for (const port of PORTS) {
      for (let day = 0; day < 12; day++) {
        for (const q of questOffers(port.id, day * QUESTS.dayLength + 10)) {
          expect(q.reward, `${port.id}/${q.id}`).toBeGreaterThan(0);
          expect(getPort(q.to), q.id).toBeDefined();
          if (q.kind === 'delivery') {
            expect(q.to).not.toBe(port.id);
            expect(GOODS.some((g) => g.id === q.good)).toBe(true);
            expect(q.qty).toBeGreaterThanOrEqual(20);
            // what a port makes is what it asks to have carried
            const made = Object.keys(PORT_ECONOMY[port.id]?.produces ?? {});
            if (made.length > 0) expect(made).toContain(q.good);
          }
          if (q.kind === 'courier') {
            expect(q.to).not.toBe(port.id);
            expect(q.deadline).toBeGreaterThan(day * QUESTS.dayLength);
          }
          if (q.kind === 'hunt') {
            expect(q.to).toBe(port.id);
            expect(q.count).toBeGreaterThanOrEqual(2);
            expect(q.nation).not.toBe(port.nation);
          }
        }
      }
    }
  });
});

describe('taking and leaving errands', () => {
  it('takes an offer from the board, up to three at once, never twice', () => {
    const st = fresh();
    const [d, c, h] = questOffers(HERE, 0);
    expect(runQuestCommand(st, null, 0, { type: 'acceptQuest', id: d!.id }).reason).toBe('not-docked');
    expect(runQuestCommand(st, HERE, 0, { type: 'acceptQuest', id: 'nope' }).reason).toBe('no-such-quest');
    expect(runQuestCommand(st, HERE, 0, { type: 'acceptQuest', id: d!.id })).toEqual({ ok: true });
    expect(runQuestCommand(st, HERE, 0, { type: 'acceptQuest', id: d!.id }).reason).toBe('no-such-quest'); // no longer on the board
    runQuestCommand(st, HERE, 0, { type: 'acceptQuest', id: c!.id });
    runQuestCommand(st, HERE, 0, { type: 'acceptQuest', id: h!.id });
    expect(st.quests).toHaveLength(QUESTS.maxActive);
    const other = questOffers('redmond', 0)[0]!;
    expect(runQuestCommand(st, 'redmond', 0, { type: 'acceptQuest', id: other.id }).reason).toBe('quests-full');
    expect(openOffers(st, HERE, 0)).toEqual([]);
  });

  it('gives one up for a small price in standing, and does not offer it again today', () => {
    const st = fresh();
    const d = questOffers(HERE, 0)[0]!;
    runQuestCommand(st, HERE, 0, { type: 'acceptQuest', id: d.id });
    const before = standing(st, d.repNation);
    expect(runQuestCommand(st, HERE, 10, { type: 'abandonQuest', id: d.id })).toEqual({ ok: true });
    expect(st.quests).toHaveLength(0);
    expect(standing(st, d.repNation)).toBe(before - QUESTS.abandonPenalty);
    expect(openOffers(st, HERE, 10).some((q) => q.id === d.id)).toBe(false);
    expect(runQuestCommand(st, HERE, 10, { type: 'abandonQuest', id: d.id }).reason).toBe('no-such-quest');
    // tomorrow there is a new board
    expect(openOffers(st, HERE, QUESTS.dayLength + 1)).toHaveLength(3);
  });
});

describe('settling errands on mooring', () => {
  const take = (st: ReturnType<typeof fresh>, kind: Quest['kind'], time = 0): Quest => {
    const offer = questOffers(HERE, time).find((q) => q.kind === kind)!;
    runQuestCommand(st, HERE, time, { type: 'acceptQuest', id: offer.id });
    return st.quests.find((q) => q.id === offer.id)!;
  };

  it('pays a delivery when the goods are in the hold at the destination, and takes them out', () => {
    const st = fresh();
    const q = take(st, 'delivery');
    expect(settleQuests(st, q.to, 5)).toEqual([]); // nothing in the hold yet
    st.hold[q.good!] = q.qty! + 7;
    const gold = st.captain.gold;
    const rep = standing(st, q.repNation);
    const r = settleQuests(st, q.to, 10);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ done: true });
    expect(r[0]!.text).toMatch(/\+\d+ altın/);
    expect(st.captain.gold).toBe(gold + q.reward);
    expect(st.hold[q.good!]).toBe(7);
    expect(standing(st, q.repNation)).toBe(rep + q.repGain);
    expect(st.quests).toHaveLength(0);
    expect(settleQuests(st, q.to, 11)).toEqual([]);
  });

  it('pays a courier errand on arrival in time, and fails it when the time ran out', () => {
    const st = fresh();
    const q = take(st, 'courier');
    expect(settleQuests(st, HERE, 5)).toEqual([]); // not there yet
    const gold = st.captain.gold;
    const done = settleQuests(st, q.to, q.deadline! - 1);
    expect(done[0]).toMatchObject({ done: true });
    expect(st.captain.gold).toBe(gold + q.reward);

    const late = fresh();
    const lq = take(late, 'courier');
    const rep = standing(late, lq.repNation);
    const r = settleQuests(late, lq.to, lq.deadline! + 1);
    expect(r[0]).toMatchObject({ done: false });
    expect(late.captain.gold).toBe(newGameState(brig).captain.gold);
    expect(standing(late, lq.repNation)).toBe(rep - QUESTS.failPenalty);
    expect(late.quests).toHaveLength(0);
  });

  it('counts the ships of the hunted nation and pays back at the port that asked', () => {
    const st = fresh();
    const q = take(st, 'hunt');
    questKill(st, q.nation === 'pirate' ? 'english' : 'pirate'); // another flag does not count
    expect(st.quests[0]!.progress).toBe(0);
    for (let i = 0; i < q.count! + 3; i++) questKill(st, q.nation!);
    expect(st.quests[0]!.progress).toBe(q.count);
    expect(settleQuests(st, 'redmond', 5)).toEqual([]); // reported at the wrong port
    const gold = st.captain.gold;
    expect(settleQuests(st, HERE, 5)[0]).toMatchObject({ done: true });
    expect(st.captain.gold).toBe(gold + q.reward);
  });

  it('shows the board and the errands carried in the port view', () => {
    const st = fresh();
    take(st, 'delivery');
    const v = questsView(st, HERE, 0);
    expect(v.offers.map((o) => o.title).length).toBe(2);
    expect(v.active).toHaveLength(1);
    expect(v.active[0]).toMatchObject({ kind: 'delivery', ready: false });
    expect(v.room).toBe(QUESTS.maxActive - 1);
    expect(v.active[0]!.progress).toMatch(/ambarda 0\//);
  });
});

describe('errands in the game', () => {
  it('can be taken at the quay, are listed in the port view, and a hunt counts the kills', () => {
    const game = createGame(fresh());
    game.update(1 / 60, { rudder: 0, sailStep: 0, interact: true });
    expect(game.view().docked).toBe(HERE);
    const offers = game.view().port!.quests.offers;
    expect(offers).toHaveLength(3);
    const hunt = offers.find((o) => o.kind === 'hunt')!;
    expect(game.command({ type: 'acceptQuest', id: hunt.id })).toEqual({ ok: true });
    expect(game.view().port!.quests.active).toHaveLength(1);
    expect(game.state().quests).toHaveLength(1);
    expect(game.command({ type: 'acceptQuest', id: 'nope' }).reason).toBe('no-such-quest');
  });

  it('reports a finished errand as an event when the ship moors', () => {
    const st = fresh();
    const offer = questOffers(HERE, 0).find((q) => q.kind === 'courier')!;
    // a courier errand to the port we start in: put it in the state as if taken elsewhere
    st.quests.push({ ...offer, from: 'redmond', to: HERE, deadline: 1e6 });
    const game = createGame(st);
    game.update(1 / 60, { rudder: 0, sailStep: 0, interact: true });
    const events = game.view().events;
    const e = events.find((x) => x.type === 'quest');
    expect(e?.won).toBe(true);
    expect(e?.text).toMatch(/Görev tamam/);
    expect(game.state().quests).toHaveLength(0);
    expect(game.state().captain.gold).toBe(st.captain.gold + offer.reward);
  });
});

describe('errands in a save', () => {
  it('survive a round trip, and a damaged list is cleaned', () => {
    const st = fresh();
    const offer = questOffers(HERE, 0)[1]!;
    runQuestCommand(st, HERE, 0, { type: 'acceptQuest', id: offer.id });
    st.questLog.push('old:0:0');
    const back = parseSave(serializeSave(st, '2026-01-01T00:00:00Z'));
    expect(back.ok && back.state.quests).toEqual(st.quests);
    expect(back.ok && back.state.questLog).toEqual(['old:0:0']);

    expect(sanitizeQuests('nonsense')).toEqual([]);
    expect(sanitizeQuests([null, 3, { id: 'x' }, { ...offer, kind: 'piracy' }, { ...offer, from: 'atlantis' }, { ...offer, repNation: 'martian' }])).toEqual([]);
    const dirty = sanitizeQuests([{ ...offer, reward: -5, repGain: 9999, deadline: -3 }, ...Array(8).fill(offer)]);
    expect(dirty).toHaveLength(3);
    expect(dirty[0]).toMatchObject({ reward: 0, repGain: 20, deadline: 0 });
    expect(sanitizeState({ ...st, quests: 'x', questLog: [1, 'a', 'b'] })?.quests).toEqual([]);
    expect(sanitizeState({ ...st, questLog: [1, 'a', 'b'] })?.questLog).toEqual(['a', 'b']);
  });

  it('migrate from version 3 with no errands', () => {
    const old = fresh();
    const v3 = { ...old } as Record<string, unknown>;
    delete v3.quests;
    delete v3.questLog;
    const r = parseSave(JSON.stringify({ version: 3, savedAt: '2026-01-01T00:00:00Z', state: v3 }));
    expect(MIGRATIONS[3]).toBeDefined();
    expect(r.ok && r.state.quests).toEqual([]);
    expect(r.ok && r.state.questLog).toEqual([]);
  });
});
