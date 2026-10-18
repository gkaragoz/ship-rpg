import { CONFIG } from '../core';
import type { Controls, GameEvent, WindView } from '../core';
import type { ShipSpec } from '../ships';
import type { Side } from './combat';
import type { Enemy } from './enemy';
import { COMBAT } from './combat';
import { consortOrders, launchConsorts, writeBackFleet, type Consort } from './fleet';
import { addPrize, chargeUpkeep } from './fleetYard';
import type { PlayerShip } from './sailing';
import { MAX_CONSORTS, type GameState } from './state';

/** What the fleet director needs from the game: the flagship, the weather, the physics of a hull, and a way to order a salvo. */
export interface DirectorDeps {
  st: GameState;
  ship(): PlayerShip;
  wind(): WindView;
  enemies(): readonly Enemy[];
  /** Move an enemy-shaped hull one step: sailing, the sea's motion, leaks and fire (the game's own physics). */
  advance(c: Enemy, controls: Controls, dt: number): void;
  /** Order a broadside from a hull of the captain's side. */
  fire(hull: PlayerShip, spec: ShipSpec, side: Side, alive: () => boolean): void;
  emit(event: GameEvent): void;
  /** Share of the hull a moored ship mends per second. */
  repairRate: number;
}

export interface FleetDirector {
  /** The consorts under sail (empty while moored). */
  consorts(): readonly Consort[];
  /** Put the fleet on the water around the flagship (an undocking, a new run, a loaded game). */
  launch(): void;
  /** The flagship moors: the fleet comes in, is mended and manned, and its upkeep is paid; returns the gold the upkeep took. */
  moor(time: number): number;
  /** One fixed step: every consort follows its orders. */
  step(dt: number): void;
  /** A consort was hit for `lost` hull points. */
  hit(c: Consort, lost: number): void;
  /** Write the consorts' hulls back to the run's fleet (a save is about to read it). */
  sync(): void;
  /** Take a beaten enemy into the fleet as a prize: false when the fleet is full or the flagship is moored. */
  capture(prize: Enemy): boolean;
}

export function createFleetDirector(d: DirectorDeps): FleetDirector {
  let list: Consort[] = [];

  const sinkCheck = (c: Consort): void => {
    if (c.hp > 0 || c.sinking >= 0) return;
    c.sinking = 0;
    d.emit({ type: 'sunk', owner: 'player', x: c.ship.x, y: 0, z: c.ship.z, length: c.spec.length });
    // a sunk ship is gone from the fleet for good
    d.st.fleet = d.st.fleet.filter((f) => f !== c.entry);
  };

  return {
    consorts: () => list,
    launch(): void {
      list = launchConsorts(d.st, d.ship());
    },
    moor(time): number {
      writeBackFleet(d.st, list);
      list = [];
      for (const f of d.st.fleet) {
        f.rigging = 1;
        f.crew = Math.max(f.crew, 1);
      }
      return chargeUpkeep(d.st, time);
    },
    step(dt): void {
      const flagship = d.ship();
      const enemies = d.enemies();
      for (const c of list) {
        if (c.sinking >= 0) {
          c.sinking += dt;
          c.ship.speed *= 1 - 0.5 * dt;
          continue;
        }
        const orders = consortOrders(c, flagship, d.wind(), enemies, list);
        d.advance(c, orders.controls, dt);
        sinkCheck(c);
        if (c.sinking >= 0) continue;
        c.reload.port = Math.max(0, c.reload.port - dt);
        c.reload.starboard = Math.max(0, c.reload.starboard - dt);
        if (orders.fire) {
          d.fire(c.ship, c.spec, orders.fire, () => c.sinking < 0);
          c.reload[orders.fire] = COMBAT.playerReload;
        }
      }
      list = list.filter((c) => c.sinking < CONFIG.sinkSeconds);
    },
    hit(c, lost): void {
      c.hp = Math.max(0, c.hp - lost);
      sinkCheck(c);
    },
    sync(): void {
      writeBackFleet(d.st, list.filter((c) => c.sinking < 0));
    },
    capture(prize): boolean {
      if (d.st.fleet.length >= MAX_CONSORTS || prize.hp <= 0) return false;
      if (!addPrize(d.st, prize.spec, prize.hp)) return false;
      const flagship = d.ship();
      const entry = d.st.fleet[d.st.fleet.length - 1];
      if (!entry) return false;
      // the prize hands over where it lies: it is a consort from now on, keeping its place on the water
      const taken = launchConsorts(d.st, flagship).find((c) => c.entry === entry);
      if (!taken) return false;
      taken.ship = prize.ship;
      taken.hp = prize.hp;
      taken.maxHp = prize.spec.stats.hp;
      taken.nation = 'free';
      taken.fleeing = false;
      taken.surrendered = false;
      list = [...list.filter((c) => c.entry !== entry), taken];
      list.sort((a, b) => a.slot - b.slot);
      return true;
    },
  };
}
