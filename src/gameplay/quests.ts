import type { CommandResult, PortCommand, QuestOfferView, QuestView } from '../core';
import { GOODS, PORTS, PORT_ECONOMY, REPUTATION_NATIONS, enemiesOf, getGood, getPort, type Port } from '../world';
import { addStanding } from './reputation';
import { createRng } from './rng';
import type { GameState } from './state';

/** The kinds of errand a tavern keeper offers. */
export type QuestKind = 'delivery' | 'courier' | 'hunt';

/** An errand the captain has taken on (saved with the run). */
export interface Quest {
  /** `portId:day:slot`: stable, so an offer is never offered twice and a taken one is not offered back. */
  id: string;
  kind: QuestKind;
  /** The port that gave it, and where it is to be done: a delivery or courier errand ends at `to`, a hunt back at `from`. */
  from: string;
  to: string;
  /** Delivery: goods to bring. */
  good?: string;
  qty?: number;
  /** Hunt: ships of this nation to sink or take, and how many have been. */
  nation?: string;
  count?: number;
  progress?: number;
  /** Gold on completion, and the standing it wins with `repNation`. */
  reward: number;
  repNation: string;
  repGain: number;
  /** Game second after which a courier errand (or a delivery that has one) has failed. */
  deadline?: number;
}

/** How errands are made, paid and kept. */
export const QUESTS = {
  /** Errands the captain may carry at once, and offers a port has each day. */
  maxActive: 3,
  offersPerDay: 3,
  /** Game seconds in a day of offers (the tavern's board changes then). */
  dayLength: 1800,
  /** Courier: seconds allowed per metre (the sloop-like pace the errand is set for), plus a margin. */
  courierPace: 0.25,
  courierMargin: 150,
  /** Standing lost for a failed or abandoned errand. */
  failPenalty: 3,
  abandonPenalty: 1,
  /** Finished and abandoned ids kept, so they are not offered again today. */
  logLimit: 60,
} as const;

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const distance = (a: Port, b: Port): number => Math.hypot(a.anchor.x - b.anchor.x, a.anchor.z - b.anchor.z);

/** The day of offers that game second `time` falls in. */
export const questDay = (time: number): number => Math.floor(Math.max(0, time) / QUESTS.dayLength);

/**
 * What the board at `portId` offers on the day of `time`: a delivery, a courier errand and a hunt, deterministic for the
 * port and the day (the same board all day, a fresh one tomorrow). Taken and finished ones are filtered by the caller.
 */
export function questOffers(portId: string, time: number): Quest[] {
  const here = getPort(portId);
  if (!here) return [];
  const day = questDay(time);
  const rng = createRng(hash(portId) + day * 7919);
  const others = PORTS.filter((p) => p.id !== portId);
  const pickPort = (pool: readonly Port[]): Port => pool[rng.int(pool.length)] ?? (others[0] as Port);
  const out: Quest[] = [];

  // delivery: something this port makes, to a port that wants it (or any), for more than the market pays
  const made = Object.keys(PORT_ECONOMY[portId]?.produces ?? {});
  const goodId = made.length > 0 ? (rng.pick(made) as string) : (rng.pick(GOODS.map((g) => g.id)) as string);
  const wanting = others.filter((p) => (PORT_ECONOMY[p.id]?.demands[goodId] ?? 0) > 0);
  const dest = pickPort(wanting.length > 0 ? wanting : others);
  const qty = 20 + rng.int(5) * 5;
  const base = getGood(goodId)?.base ?? 20;
  out.push({
    id: `${portId}:${day}:0`, kind: 'delivery', from: portId, to: dest.id, good: goodId, qty,
    reward: Math.round(qty * base * (1.35 + distance(here, dest) / 5000)), repNation: dest.nation, repGain: 3,
  });

  // courier: a letter to a port, against the clock
  const far = pickPort(others);
  const d = distance(here, far);
  out.push({
    id: `${portId}:${day}:1`, kind: 'courier', from: portId, to: far.id,
    reward: Math.round(150 + d * 0.5), repNation: far.nation, repGain: 2, deadline: day * QUESTS.dayLength + QUESTS.dayLength / 2 + d * QUESTS.courierPace + QUESTS.courierMargin,
  });

  // hunt: ships of a nation the port is at war with (pirates for a port with no war)
  const foes = [...enemiesOf(here.nation), 'pirate'];
  const nation = here.nation === 'pirate' || here.nation === 'free' ? 'spanish' : (rng.pick(foes) as string);
  const count = 2 + rng.int(2);
  out.push({
    id: `${portId}:${day}:2`, kind: 'hunt', from: portId, to: portId, nation, count, progress: 0,
    reward: 320 * count + rng.int(4) * 50, repNation: here.nation, repGain: 4,
  });
  return out.slice(0, QUESTS.offersPerDay);
}

/** Make an errand's offer into the one the captain carries: its deadline counts from now for a courier. */
function accepted(offer: Quest, time: number): Quest {
  const q: Quest = { ...offer, progress: offer.kind === 'hunt' ? 0 : undefined };
  if (q.kind === 'courier' && q.deadline !== undefined) q.deadline = Math.max(q.deadline, time + QUESTS.courierMargin);
  return q;
}

const remember = (st: GameState, id: string): void => {
  st.questLog.push(id);
  if (st.questLog.length > QUESTS.logLimit) st.questLog.splice(0, st.questLog.length - QUESTS.logLimit);
};

/** The offers the captain could still take at `portId` now. */
export const openOffers = (st: GameState, portId: string, time: number): Quest[] =>
  questOffers(portId, time).filter((o) => !st.quests.some((q) => q.id === o.id) && !st.questLog.includes(o.id));

/** The errand commands of the tavern: take an errand from the board, or give one up. */
export function runQuestCommand(st: GameState, portId: string | null, time: number, cmd: PortCommand): CommandResult {
  if (!portId) return { ok: false, reason: 'not-docked' };
  if (cmd.type === 'acceptQuest') {
    if (st.quests.length >= QUESTS.maxActive) return { ok: false, reason: 'quests-full' };
    const offer = openOffers(st, portId, time).find((o) => o.id === cmd.id);
    if (!offer) return { ok: false, reason: 'no-such-quest' };
    st.quests.push(accepted(offer, time));
    return { ok: true };
  }
  if (cmd.type === 'abandonQuest') {
    const i = st.quests.findIndex((q) => q.id === cmd.id);
    const q = st.quests[i];
    if (!q) return { ok: false, reason: 'no-such-quest' };
    st.quests.splice(i, 1);
    remember(st, q.id);
    addStanding(st, q.repNation, -QUESTS.abandonPenalty);
    return { ok: true };
  }
  return { ok: false, reason: 'bad-qty' };
}

/** A ship of `nation` was sunk or taken: it counts for every hunt after it. */
export function questKill(st: GameState, nation: string): void {
  for (const q of st.quests) {
    if (q.kind === 'hunt' && q.nation === nation && (q.progress ?? 0) < (q.count ?? 0)) q.progress = (q.progress ?? 0) + 1;
  }
}

/** What happened to an errand when the ship moored: done and paid, or failed. */
export interface QuestResult {
  quest: Quest;
  done: boolean;
  /** A message for the captain (Turkish). */
  text: string;
}

const portName = (id: string): string => getPort(id)?.name ?? id;

/**
 * The ship has moored at `portId`: pay every errand that is done there (goods delivered and taken out of the hold, the
 * letter in time, the hunt reported) and drop those whose time ran out. Returns what happened, in order.
 */
export function settleQuests(st: GameState, portId: string, time: number): QuestResult[] {
  const results: QuestResult[] = [];
  for (const q of [...st.quests]) {
    let done = false;
    let failed = false;
    if (q.deadline !== undefined && time > q.deadline) failed = true;
    else if (q.kind === 'delivery' && q.to === portId && q.good && (st.hold[q.good] ?? 0) >= (q.qty ?? 0)) {
      st.hold[q.good] = (st.hold[q.good] ?? 0) - (q.qty ?? 0);
      if ((st.hold[q.good] ?? 0) <= 0) delete st.hold[q.good];
      done = true;
    } else if (q.kind === 'courier' && q.to === portId) done = true;
    else if (q.kind === 'hunt' && q.from === portId && (q.progress ?? 0) >= (q.count ?? 1)) done = true;
    if (!done && !failed) continue;
    st.quests.splice(st.quests.indexOf(q), 1);
    remember(st, q.id);
    if (done) {
      st.captain.gold += q.reward;
      addStanding(st, q.repNation, q.repGain);
      results.push({ quest: q, done, text: `Görev tamam: ${questTitle(q)} · +${q.reward} altın` });
    } else {
      addStanding(st, q.repNation, -QUESTS.failPenalty);
      results.push({ quest: q, done, text: `Görev kaçtı (süre doldu): ${questTitle(q)}` });
    }
  }
  return results;
}

/** One short Turkish line about an errand. */
export function questTitle(q: Quest): string {
  const good = q.good ? (getGood(q.good)?.name ?? q.good) : '';
  if (q.kind === 'delivery') return `${q.qty} ${good} → ${portName(q.to)}`;
  if (q.kind === 'courier') return `mektup → ${portName(q.to)}`;
  return `${q.count} ${q.nation === 'pirate' ? 'korsan' : (q.nation ?? '')} gemisi batır (${portName(q.from)})`;
}

const progressOf = (st: GameState, q: Quest, time: number): string => {
  if (q.kind === 'delivery') return `ambarda ${Math.min(st.hold[q.good ?? ''] ?? 0, q.qty ?? 0)}/${q.qty}`;
  if (q.kind === 'hunt') return `${q.progress ?? 0}/${q.count}`;
  return q.deadline !== undefined ? `${Math.max(0, Math.round(q.deadline - time))} sn kaldı` : '';
};

/** The errands as the port panel lists them: what the board offers, what the captain carries. */
export function questsView(st: GameState, portId: string, time: number): { offers: QuestOfferView[]; active: QuestView[]; room: number } {
  const offers = openOffers(st, portId, time).map((o): QuestOfferView => ({ id: o.id, kind: o.kind, title: questTitle(o), reward: o.reward, repNation: o.repNation, deadline: o.kind === 'courier' ? Math.max(0, Math.round((o.deadline ?? 0) - time)) : undefined }));
  const active = st.quests.map((q): QuestView => ({ id: q.id, kind: q.kind, title: questTitle(q), reward: q.reward, progress: progressOf(st, q, time), ready: questReady(st, q, time), from: q.from, to: q.to }));
  return { offers, active, room: QUESTS.maxActive - st.quests.length };
}

/** Is the errand ready to be settled where it ends (what is left is getting there)? */
export function questReady(st: GameState, q: Quest, time: number): boolean {
  if (q.deadline !== undefined && time > q.deadline) return false;
  if (q.kind === 'delivery') return (st.hold[q.good ?? ''] ?? 0) >= (q.qty ?? 0);
  if (q.kind === 'hunt') return (q.progress ?? 0) >= (q.count ?? 1);
  return true;
}

/** The nations an errand may pay in standing (for tests). */
export const QUEST_NATIONS: readonly string[] = REPUTATION_NATIONS;
