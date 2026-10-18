import type { GameEvent, Owner } from '../core';
import type { ShipSpec } from '../ships';
import type { Ball, Side } from './combat';
import { fireGun, type GunShot } from './gunnery';
import type { PlayerShip } from './sailing';

/** Total roll (rad/s) a full broadside kicks into a 30 m hull; smaller hulls feel more, bigger ones less. */
const RECOIL = 0.2;

interface Pending {
  owner: Owner;
  ship: PlayerShip;
  spec: ShipSpec;
  side: Side;
  index: number;
  count: number;
  shot: GunShot;
  wait: number;
  alive: () => boolean;
}

/**
 * Guns that have been ordered to fire and are waiting for their turn: a broadside ripples along the hull instead of going
 * off at once. Each gun fires from the ship as it is at that moment (so it moves with the ship and its roll) and kicks the
 * hull back; a gun whose ship has sunk or gone in the meantime never fires.
 */
export interface Salvo {
  /** Queue a planned broadside (see `planBroadside` with `ripple`). */
  queue(owner: Owner, ship: PlayerShip, spec: ShipSpec, side: Side, plan: readonly GunShot[], alive: () => boolean): void;
  /** Advance `dt`: the balls and muzzle blasts of the guns whose turn has come. */
  step(dt: number, nextId: () => number): { balls: Ball[]; events: GameEvent[] };
  clear(): void;
  /** Guns still waiting. */
  readonly waiting: number;
}

export function createSalvo(): Salvo {
  let list: Pending[] = [];
  return {
    queue(owner, ship, spec, side, plan, alive): void {
      plan.forEach((shot, index) => list.push({ owner, ship, spec, side, index, count: plan.length, shot, wait: shot.delay, alive }));
    },
    step(dt, nextId): { balls: Ball[]; events: GameEvent[] } {
      const balls: Ball[] = [];
      const events: GameEvent[] = [];
      if (list.length === 0) return { balls, events };
      const waiting: Pending[] = [];
      for (const p of list) {
        p.wait -= dt;
        if (p.wait > 0) {
          waiting.push(p);
          continue;
        }
        if (!p.alive()) continue;
        const gun = fireGun(p.owner, p.ship, p.spec, p.side, p.index, p.count, p.shot, nextId);
        balls.push(gun.ball);
        events.push(gun.event);
        // the recoil rolls the hull away from the guns (waveRoll is positive with the starboard side up)
        const kick = (RECOIL / p.count) * Math.min(1.5, Math.max(0.5, 30 / p.spec.length));
        p.ship.body.rollV += p.side === 'starboard' ? kick : -kick;
      }
      list = waiting;
      return { balls, events };
    },
    clear(): void {
      list = [];
    },
    get waiting(): number {
      return list.length;
    },
  };
}
