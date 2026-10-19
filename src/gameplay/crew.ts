import { angleDiff, clamp, type CrewView } from '../core';
import type { Deck } from '../ships';
import type { CrewLayout } from './crewLayout';
import { CREW, CREW_SPEED, CREW_VARIANTS, JOBS } from './crewData';
import { makeLook, type Job, type Sailor } from './crewTypes';
import { createRng } from './rng';

export interface CrewSim {
  /** Advance by one fixed step (seconds). */
  update(dt: number): void;
  view(): CrewView[];
  /** The sail level the ship is trimmed to now: a change sends hands to the masts (climbing, hauling). Purely visual. */
  sails(target: number): void;
  /** A broadside went off on this side: the gun crews fire, then load for `reload` seconds. Purely visual. */
  fire(side: 'port' | 'starboard', reload: number): void;
  /** The helmsman's wheel follows the rudder (−1 … 1). */
  helm(rudder: number): void;
}

/** How many sailors visibly work a deck of this length. */
export const crewCountFor = (shipLength: number): number =>
  clamp(Math.round(shipLength * 0.5), CREW.minCount, CREW.maxCount);

/**
 * Deterministic deck life for a ship's crew: sailors stand, then walk (sometimes run) to a random free spot, steering
 * around the mast, hatch and barrels described by the deck. With a `layout` they also work the ship: one stands at the
 * helm, sail changes send hands up the masts and onto the halyards, and a broadside sends gun crews to the rail to fire
 * and load. All of it is for show: nothing here touches the game. Runs on the fixed step; the same seed always gives the
 * same crew and the same paths.
 */
export function createCrew(deck: Deck, count: number, seed = 1, layout?: CrewLayout): CrewSim {
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
      job: null, clock: 0, lean: 0, lift: 0,
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

  // --- jobs ------------------------------------------------------------------------------------
  const nearestFree = (x: number, z: number): Sailor | null => {
    let best: Sailor | null = null;
    let bestD = Infinity;
    for (const s of sailors) {
      if (s.job) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  };

  /** Send a sailor running to the job's spot. */
  const assign = (s: Sailor, job: Job): void => {
    s.job = job;
    s.blocked = 0;
    s.clock = 0;
    s.lean = 0;
    s.tx = job.x;
    s.tz = job.z;
    s.speed = CREW_SPEED.run;
    s.anim = 'Run';
    s.moving = true;
  };

  /** A free standing spot on a ring around (cx, cz): the one nearest `from`. */
  const ringSpot = (cx: number, cz: number, radius: number, from: { x: number; z: number }): { x: number; z: number } | null => {
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = cx + Math.cos(a) * radius;
      const z = cz + Math.sin(a) * radius;
      const d = Math.hypot(x - from.x, z - from.z);
      if (d < bestD && deck.walkable(x, z, r) && pathClear(from.x, from.z, x, z)) {
        best = { x, z };
        bestD = d;
      }
    }
    return best;
  };

  let lastSail: number | null = null;
  let sailCooldown = 0;
  let rudder = 0;

  const startSailWork = (): void => {
    if (!layout) return;
    for (const m of layout.masts.slice(0, JOBS.maxMasts)) {
      const climber = nearestFree(m.x, 0);
      const climbSpot = climber && ringSpot(m.x, 0, 0.9, climber);
      if (climber && climbSpot) {
        assign(climber, { kind: 'climb', stage: 'go', x: climbSpot.x, z: climbSpot.z, faceX: m.x, faceZ: 0, top: Math.min(JOBS.climbTop * m.height, JOBS.climbMax), left: 0, load: 0 });
      }
      const hauler = nearestFree(m.x, 0);
      const haulSpot = hauler && ringSpot(m.x, 0, 1.5, hauler);
      if (hauler && haulSpot) {
        assign(hauler, { kind: 'haul', stage: 'go', x: haulSpot.x, z: haulSpot.z, faceX: m.x, faceZ: 0, top: 0, left: 0, load: 0 });
      }
    }
  };

  const startGuns = (side: 'port' | 'starboard', reload: number): void => {
    const spots = layout?.guns[side] ?? [];
    // the stations nearest the middle of the deck first: they are the ones a small crew can reach
    for (const spot of spots.slice(0, JOBS.gunners)) {
      const gunner = nearestFree(spot.x, spot.z);
      if (!gunner || !pathClear(gunner.x, gunner.z, spot.x, spot.z)) continue;
      assign(gunner, { kind: 'gun', stage: 'go', x: spot.x, z: spot.z, faceX: spot.x, faceZ: spot.z * 3, top: 0, left: 0, load: clamp(reload - JOBS.fireTime, 1, JOBS.maxLoad) });
    }
  };

  const helmSailor = layout?.helm ? sailors[0] : undefined;
  if (layout?.helm && helmSailor) {
    helmSailor.x = helmSailor.tx = layout.helm.x;
    helmSailor.z = helmSailor.tz = layout.helm.z;
    helmSailor.heading = 0;
    helmSailor.anim = 'Helm';
    helmSailor.job = { kind: 'helm', stage: 'work', x: layout.helm.x, z: layout.helm.z, faceX: layout.helm.x + 5, faceZ: layout.helm.z, top: 0, left: Infinity, load: 0 };
  }

  const face = (s: Sailor, tx: number, tz: number, dt: number): void => {
    const diff = angleDiff(Math.atan2(tz - s.z, tx - s.x), s.heading);
    s.heading += clamp(diff, -CREW.turnRate * dt, CREW.turnRate * dt);
  };

  const release = (s: Sailor): void => {
    s.job = null;
    s.lift = 0;
    s.lean = 0;
    s.clock = 0;
    stop(s);
  };

  /** The sailor has reached the job's spot: start its first working stage. */
  const arrive = (s: Sailor, job: Job): void => {
    s.moving = false;
    s.speed = 0;
    s.clock = 0;
    s.x = job.x;
    s.z = job.z;
    if (job.kind === 'haul') Object.assign(job, { stage: 'work', left: JOBS.haulTime });
    else if (job.kind === 'climb') Object.assign(job, { stage: 'work', left: JOBS.climbTime });
    else if (job.kind === 'gun') Object.assign(job, { stage: 'fire', left: JOBS.fireTime });
  };

  const stepJob = (s: Sailor, job: Job, dt: number): void => {
    s.clock += dt;
    face(s, job.faceX, job.faceZ, dt);
    job.left -= dt;
    if (job.kind === 'helm') {
      s.anim = 'Helm';
      s.lean = rudder;
    } else if (job.kind === 'haul') {
      s.anim = 'Haul';
      if (job.left <= 0) release(s);
    } else if (job.kind === 'climb') {
      if (job.stage === 'work') {
        s.anim = 'Climb';
        s.lean = clamp(1 - job.left / JOBS.climbTime, 0, 1);
        s.lift = job.top * s.lean;
        if (job.left <= 0) Object.assign(job, { stage: 'top', left: JOBS.aloftTime });
      } else if (job.stage === 'top') {
        s.anim = 'Aloft';
        if (job.left <= 0) Object.assign(job, { stage: 'down', left: JOBS.climbTime });
      } else {
        s.anim = 'Climb';
        s.lean = clamp(job.left / JOBS.climbTime, 0, 1);
        s.lift = job.top * s.lean;
        if (job.left <= 0) release(s);
      }
    } else if (job.stage === 'fire') {
      s.anim = 'Fire';
      s.lean = clamp(1 - job.left / JOBS.fireTime, 0, 1);
      if (job.left <= 0) Object.assign(job, { stage: 'load', left: job.load });
    } else {
      s.anim = 'Load';
      if (job.left <= 0) release(s);
    }
  };

  return {
    update(dt): void {
      sailCooldown = Math.max(0, sailCooldown - dt);
      for (const s of sailors) {
        if (s.job && s.job.stage !== 'go' && !s.moving) {
          stepJob(s, s.job, dt);
          continue;
        }
        if (!s.moving) {
          s.timer -= dt;
          if (s.timer <= 0) startTrip(s);
          continue;
        }
        const dx = s.tx - s.x;
        const dz = s.tz - s.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.12) {
          if (s.job) arrive(s, s.job);
          else stop(s);
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
          if (s.job) arrive(s, s.job); // boxed in on the way to the job: it is simply there (a short pop beats a gun nobody serves)
          else stop(s);
        }
      }
    },
    view(): CrewView[] {
      return sailors.map((s) => ({
        id: s.id, x: s.x, y: deck.heightAt(s.x) + s.lift, z: s.z, heading: s.heading, anim: s.anim, look: s.look, clock: s.clock, lean: s.lean,
      }));
    },
    sails(target): void {
      if (lastSail === null) {
        lastSail = target;
        return;
      }
      if (Math.abs(target - lastSail) > 0.01 && sailCooldown <= 0) {
        lastSail = target;
        sailCooldown = JOBS.sailCooldown;
        startSailWork();
      }
    },
    fire(side, reload): void {
      startGuns(side, reload);
    },
    helm(next): void {
      rudder = clamp(next, -1, 1);
    },
  };
}
