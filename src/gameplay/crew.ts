import { angleDiff, clamp, type CrewAnim, type CrewLook, type CrewView } from '../core';
import type { Deck } from '../ships';
import { CREW, CREW_PALETTE_SIZES, CREW_SPEED, CREW_VARIANTS, FIRST_FEMALE_VARIANT } from './crewData';
import { createRng, type Rng } from './rng';

export interface CrewSim {
  /** Advance by one fixed step (seconds). */
  update(dt: number): void;
  view(): CrewView[];
}

/** How many sailors visibly work a deck of this length. */
export const crewCountFor = (shipLength: number): number =>
  clamp(Math.round(shipLength * 0.5), CREW.minCount, CREW.maxCount);

interface Sailor {
  id: number;
  x: number;
  z: number;
  heading: number;
  anim: CrewAnim;
  speed: number;
  moving: boolean;
  timer: number;
  tx: number;
  tz: number;
  blocked: number;
  look: CrewLook;
}

function makeLook(rng: Rng, variant: number): CrewLook {
  const female = variant >= FIRST_FEMALE_VARIANT;
  const hairStyle: CrewLook['hairStyle'] = female ? (rng.chance(0.65) ? 'long' : 'short') : rng.chance(0.75) ? 'short' : 'none';
  return {
    variant,
    skin: rng.int(CREW_PALETTE_SIZES.skin),
    shirt: rng.int(CREW_PALETTE_SIZES.shirt),
    pants: rng.int(CREW_PALETTE_SIZES.pants),
    hair: rng.int(CREW_PALETTE_SIZES.hair),
    hat: rng.int(CREW_PALETTE_SIZES.hat),
    hairStyle,
    hatStyle: rng.pick(['wide', 'bandana', 'cap', 'none'] as const),
    beard: !female && rng.chance(0.45),
  };
}

/**
 * Deterministic deck wandering for the player's crew: stand, then walk (sometimes run) to a
 * random free spot, steering around the mast, hatch and barrels described by the deck.
 * Runs on the fixed step; the same seed always gives the same crew and the same paths.
 */
export function createCrew(deck: Deck, count: number, seed = 1): CrewSim {
  const rng = createRng(seed);
  const r = CREW.bodyRadius;

  const freeSpot = (): { x: number; z: number } | null => {
    for (let i = 0; i < 40; i++) {
      const x = rng.range(deck.minX, deck.maxX);
      const z = rng.range(-1, 1) * deck.halfWidthAt(x);
      if (deck.walkable(x, z, r)) return { x, z };
    }
    return null;
  };

  /** True when the straight line a→b stays on free deck (sampled every 20 cm). */
  const pathClear = (ax: number, az: number, bx: number, bz: number): boolean => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2));
    for (let i = 1; i <= n; i++) {
      if (!deck.walkable(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n, r)) return false;
    }
    return true;
  };

  const sailors: Sailor[] = [];
  for (let id = 0; id < count; id++) {
    const spot = freeSpot() ?? { x: 0, z: 0 };
    sailors.push({
      id, x: spot.x, z: spot.z, heading: rng.range(-Math.PI, Math.PI), anim: 'Idle', speed: 0, moving: false,
      timer: rng.range(0, CREW.idle[1]), tx: spot.x, tz: spot.z, blocked: 0,
      look: makeLook(rng, rng.int(CREW_VARIANTS)),
    });
  }

  const startTrip = (s: Sailor): void => {
    for (let i = 0; i < 12; i++) {
      const spot = freeSpot();
      if (!spot) break;
      const d = Math.hypot(spot.x - s.x, spot.z - s.z);
      if (d < CREW.tripLength[0] || d > CREW.tripLength[1] || !pathClear(s.x, s.z, spot.x, spot.z)) continue;
      s.tx = spot.x;
      s.tz = spot.z;
      s.speed = rng.chance(CREW.runChance) ? CREW_SPEED.run : CREW_SPEED.walk;
      s.anim = s.speed === CREW_SPEED.run ? 'Run' : 'Walk';
      s.moving = true;
      s.blocked = 0;
      return;
    }
    s.timer = 0.5; // nothing reachable right now; try again shortly
  };

  const stop = (s: Sailor): void => {
    s.moving = false;
    s.anim = 'Idle';
    s.speed = 0;
    s.timer = rng.range(CREW.idle[0], CREW.idle[1]);
  };

  return {
    update(dt): void {
      for (const s of sailors) {
        if (!s.moving) {
          s.timer -= dt;
          if (s.timer <= 0) startTrip(s);
          continue;
        }
        const dx = s.tx - s.x;
        const dz = s.tz - s.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.12) {
          stop(s);
          continue;
        }
        const diff = angleDiff(Math.atan2(dz, dx), s.heading);
        s.heading += clamp(diff, -CREW.turnRate * dt, CREW.turnRate * dt);
        // Turn on the spot first, then walk; never overshoot the target.
        const step = Math.min(s.speed * dt * Math.max(0, Math.cos(diff)), dist);
        const nx = s.x + Math.cos(s.heading) * step;
        const nz = s.z + Math.sin(s.heading) * step;
        if (deck.walkable(nx, nz, r)) {
          s.x = nx;
          s.z = nz;
          s.blocked = 0;
        } else if ((s.blocked += dt) > CREW.stuckAfter) {
          stop(s);
        }
      }
    },
    view(): CrewView[] {
      return sailors.map((s) => ({
        id: s.id, x: s.x, y: deck.heightAt(s.x), z: s.z, heading: s.heading, anim: s.anim, look: s.look,
      }));
    },
  };
}
