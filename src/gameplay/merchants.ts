import type { GameEvent, OtherShipView } from '../core';
import { getShipSpec, type ShipSpec } from '../ships';
import { lootOf } from './boarding';
import { levelFor, lootBonus, xpForKill } from './progression';
import { recordKill } from './reputation';
import { strength } from './enemy';
import { questKill } from './quests';
import type { GameState } from './state';

/** The merchants' fate under the captain's guns: unarmed hulls that sink, are plundered, and sail again after a while. */
export const MERCHANT = {
  /** Hull strength as a share of the type's listed value (a laden merchant is soft). */
  hullFactor: 0.7,
  /** Game seconds a sunk merchant is gone before a new one takes its round. */
  respawn: 900,
  /** What a wreck's floating cargo yields, against a boarded prize: the share of the loot and of a kill's experience. */
  lootShare: 0.4,
  xpShare: 0.4,
} as const;

interface Fate {
  hp: number;
  /** Game second it sank, or null while afloat. */
  sankAt: number | null;
}

/** What a ball needs to know about a merchant afloat. */
export interface MerchantTarget {
  id: number;
  ship: { x: number; z: number; heading: number };
  spec: ShipSpec;
}

export interface MerchantBook {
  /** Merchants (ids from `firstId`) that are afloat now, as shot targets. */
  targets(others: readonly OtherShipView[], time: number): MerchantTarget[];
  /** A merchant was hit for `lost` hull points; returns true when that sank it. */
  hit(id: number, spec: ShipSpec, lost: number, time: number): boolean;
  isSunk(id: number, time: number): boolean;
  /** The other ships as the view carries them: the sunk merchants flagged. */
  mark(others: readonly OtherShipView[], time: number): OtherShipView[];
}

/** The hit points, sinkings and respawns of the merchants (ids from `firstId` up: the patrols before them are not shot at). */
export function createMerchantBook(firstId: number): MerchantBook {
  const fates = new Map<number, Fate>();
  const fate = (id: number, spec: ShipSpec): Fate => {
    let f = fates.get(id);
    if (!f) {
      f = { hp: Math.round(spec.stats.hp * MERCHANT.hullFactor), sankAt: null };
      fates.set(id, f);
    }
    return f;
  };
  const isSunk = (id: number, time: number): boolean => {
    const f = fates.get(id);
    if (!f || f.sankAt === null) return false;
    if (time - f.sankAt >= MERCHANT.respawn) {
      fates.delete(id); // a new merchant takes the round
      return false;
    }
    return true;
  };
  return {
    isSunk,
    targets(others, time): MerchantTarget[] {
      const out: MerchantTarget[] = [];
      for (const o of others) {
        const spec = o.id >= firstId ? getShipSpec(o.specId) : undefined;
        if (spec && !isSunk(o.id, time)) out.push({ id: o.id, ship: o, spec });
      }
      return out;
    },
    hit(id, spec, lost, time): boolean {
      const f = fate(id, spec);
      if (f.sankAt !== null) return false;
      f.hp = Math.max(0, f.hp - lost);
      if (f.hp > 0) return false;
      f.sankAt = time;
      return true;
    },
    mark: (others, time) => others.map((o) => (o.id >= firstId && isSunk(o.id, time) ? { ...o, sunk: true } : o)),
  };
}

/**
 * A merchant went down under the captain's guns: its flag hates him for it (and its enemies like him better), a hunt
 * errand counts it, and he fishes some of the cargo out of the water. Returns the events to show.
 */
export function plunderMerchant(st: GameState, spec: ShipSpec, nation: string, at: { x: number; z: number }, freeSpace: number, rng: () => number): GameEvent[] {
  const events: GameEvent[] = [{ type: 'sunk', owner: 'enemy', x: at.x, y: 0, z: at.z, length: spec.length }];
  recordKill(st, nation);
  questKill(st, nation);
  st.captain.kills++;
  st.captain.xp += Math.round(xpForKill(strength(spec), false) * MERCHANT.xpShare);
  const loot = lootOf(spec, lootBonus(levelFor(st.captain.xp)), Math.max(0, freeSpace), rng);
  const gold = Math.round(loot.gold * MERCHANT.lootShare);
  st.captain.gold += gold;
  let goods = 0;
  for (const [id, qty] of Object.entries(loot.goods)) {
    const take = Math.floor(qty * MERCHANT.lootShare);
    if (take < 1) continue;
    st.hold[id] = (st.hold[id] ?? 0) + take;
    goods += take;
  }
  events.push({ type: 'loot', owner: 'player', x: at.x, y: 0, z: at.z, gold, amount: goods });
  return events;
}
