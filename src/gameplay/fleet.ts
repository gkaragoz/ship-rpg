import { angleDiff, clamp } from '../core';
import type { WindView } from '../core';
import { getShipSpec } from '../ships';
import { aiStep, createEnemy, type AiResult, type Enemy } from './enemy';
import type { PlayerShip } from './sailing';
import type { FleetEntry, GameState } from './state';

/** A fleet ship under sail: an enemy-shaped hull (the same sailing, damage and gunnery) that flies the captain's flag. */
export interface Consort extends Enemy {
  /** The fleet entry it writes its hull, rigging and crew back to. */
  entry: FleetEntry;
  /** Place in the line (0 = first astern). */
  slot: number;
}

/** A consort engages an enemy this near (m); farther than `LEASH` from the flagship it comes back to its station. */
export const ENGAGE_RANGE = 340;
export const LEASH = 520;
/** Distance astern of the flagship of the first station, and between stations (m); stations alternate sides by this much. */
const STATION_BACK = 45;
const STATION_STEP = 32;
const STATION_SIDE = 26;

/** Put the fleet's ships on the water around the flagship, each at its station, on the flagship's heading. */
export function launchConsorts(st: GameState, flagship: PlayerShip): Consort[] {
  const out: Consort[] = [];
  st.fleet.forEach((entry, slot) => {
    const spec = getShipSpec(entry.specId);
    if (!spec) return;
    const at = stationOf(slot, flagship);
    const e = createEnemy(`c${slot + 1}`, spec, at.x, at.z, flagship.heading, 'free');
    e.maxHp = spec.stats.hp;
    e.hp = Math.min(entry.hp, e.maxHp);
    e.ship.rigging = entry.rigging;
    e.ship.sailTarget = flagship.sailTarget;
    e.ship.sailLevel = flagship.sailLevel;
    e.ship.speed = flagship.speed;
    e.reload = { port: 2 + slot, starboard: 2 + slot };
    out.push({ ...e, entry, slot });
  });
  return out;
}

/** Write what happened to the consorts back to the run's fleet; a sunk consort is lost, a ship that stayed afloat keeps its hull. */
export function writeBackFleet(st: GameState, consorts: readonly Consort[]): void {
  const sunk = new Set<FleetEntry>();
  for (const c of consorts) {
    if (c.hp <= 0 || c.sinking >= 0) {
      sunk.add(c.entry);
      continue;
    }
    c.entry.hp = Math.max(1, Math.round(c.hp));
    c.entry.rigging = clamp(c.ship.rigging, 0, 1);
  }
  if (sunk.size > 0) st.fleet = st.fleet.filter((f) => !sunk.has(f));
}

/** The point a consort of line place `slot` keeps: astern of the flagship, alternating to either side. */
export function stationOf(slot: number, flagship: Pick<PlayerShip, 'x' | 'z' | 'heading'>): { x: number; z: number } {
  const back = STATION_BACK + STATION_STEP * slot;
  const side = (slot % 2 === 0 ? 1 : -1) * STATION_SIDE;
  const c = Math.cos(flagship.heading);
  const s = Math.sin(flagship.heading);
  // forward is (cos h, -sin h) in (x, z); starboard is (sin h, cos h)
  return { x: flagship.x - c * back + s * side, z: flagship.z + s * back + c * side };
}

/**
 * What a consort does this step: with an enemy in reach it fights like any enemy would (turns broadside, fires); otherwise
 * it keeps its station, trimming its sails to the flagship's and crowding on when it has dropped astern.
 */
export function consortOrders(c: Consort, flagship: PlayerShip, wind: WindView, enemies: readonly Enemy[], mates: readonly Consort[]): AiResult {
  const s = c.ship;
  let prey: Enemy | null = null;
  let preyD = ENGAGE_RANGE;
  for (const e of enemies) {
    if (e.sinking >= 0 || e.gone) continue;
    const d = Math.hypot(e.ship.x - s.x, e.ship.z - s.z);
    if (d < preyD && Math.hypot(e.ship.x - flagship.x, e.ship.z - flagship.z) < LEASH) {
      prey = e;
      preyD = d;
    }
  }
  if (prey && !c.fleeing) {
    const r = aiStep(c, prey.ship, wind, mates.filter((m) => m !== c).map((m) => m.ship));
    return r;
  }
  if (c.fleeing && prey) return aiStep(c, prey.ship, wind, []); // a beaten ship runs from what beat it
  const at = stationOf(c.slot, flagship);
  const dx = at.x - s.x;
  const dz = at.z - s.z;
  const dist = Math.hypot(dx, dz);
  const toStation = Math.atan2(-dz, dx);
  // Far from the station: head for it; close to it: take the flagship's heading.
  const want = dist > 24 ? toStation : flagship.heading;
  const rudder = clamp(angleDiff(s.heading, want) * 2.5, -1, 1);
  const target = dist > 140 ? 1 : dist > 60 ? Math.min(1, flagship.sailTarget + 0.5) : flagship.sailTarget;
  const sailStep = s.sailTarget < target - 0.01 ? 1 : s.sailTarget > target + 0.01 ? -1 : 0;
  return { controls: { rudder, sailStep }, fire: null };
}
