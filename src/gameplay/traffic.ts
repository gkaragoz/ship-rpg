import type { OtherShipView, WindView } from '../core';
import { PORTS, WORLD_BOUNDS, getPort, terrainHeight, type Port } from '../world';
import { apparentView } from './enemyView';

/** Merchant ships that sail from port to port: which ship, and the ports it calls at, in order (then round again). */
export interface TrafficLine {
  specId: string;
  /** Ports of its round: it sails each leg, lies a while at the quay, and goes on. */
  calls: readonly string[];
}

export const TRAFFIC_LINES: readonly TrafficLine[] = [
  { specId: 'fleut', calls: ['redmond', 'oxbay', 'douwesen'] },
  { specId: 'galleon', calls: ['douwesen', 'conceicao', 'falaise-de-fleur'] },
  { specId: 'brig', calls: ['oxbay', 'quebradas-costillas', 'greenford'] },
  { specId: 'barque', calls: ['isla-muelle', 'douwesen', 'conceicao-smugglers'] },
  { specId: 'pinnace', calls: ['greenford', 'khoal-roa', 'redmond'] },
  { specId: 'schooner', calls: ['falaise-de-fleur', 'redmond', 'isla-muelle'] },
];

/**
 * Cruising speed of a merchant (m/s), seconds it lies at its berth, how far to the side of the anchorage the berth is (m,
 * so it never sits in the port's entry zone), the step of the water checks (m) and the least depth a lane needs (m).
 */
export const TRAFFIC = { speed: 5.5, dwell: 50, berth: 70, step: 40, clearDepth: -8 } as const;

type Point = { x: number; z: number };

const clearAt = (p: Point): boolean => terrainHeight(p.x, p.z) < TRAFFIC.clearDepth;

/** Is the straight line a→b open water all along (sampled every `TRAFFIC.step` m)? */
export function lineClear(a: Point, b: Point): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / TRAFFIC.step));
  for (let i = 1; i < n; i++) {
    if (!clearAt({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n })) return false;
  }
  return true;
}

/** Where a merchant lies at a port: off the anchorage along the coast, on the nearest open water. */
export function berthOf(port: Port): Point {
  const px = -Math.sin(port.outward);
  const pz = Math.cos(port.outward);
  for (const d of [TRAFFIC.berth, -TRAFFIC.berth, TRAFFIC.berth * 0.6, -TRAFFIC.berth * 0.6, 0]) {
    const p = { x: port.anchor.x + px * d, z: port.anchor.z + pz * d };
    if (clearAt(p)) return p;
  }
  return port.anchor;
}

// --- the lanes: A* over a coarse grid of open water, then pulled tight ------------------------
const CELL = 80;
const MARGIN = 700;
const X0 = WORLD_BOUNDS.minX - MARGIN;
const Z0 = WORLD_BOUNDS.minZ - MARGIN;
const COLS = Math.ceil((WORLD_BOUNDS.maxX + MARGIN - X0) / CELL) + 1;
const ROWS = Math.ceil((WORLD_BOUNDS.maxZ + MARGIN - Z0) / CELL) + 1;
const cellPoint = (i: number): Point => ({ x: X0 + (i % COLS) * CELL, z: Z0 + Math.floor(i / COLS) * CELL });
const cellOf = (p: Point): number => Math.min(ROWS - 1, Math.max(0, Math.round((p.z - Z0) / CELL))) * COLS + Math.min(COLS - 1, Math.max(0, Math.round((p.x - X0) / CELL)));

let water: Uint8Array | null = null;
const waterCells = (): Uint8Array => {
  if (!water) {
    water = new Uint8Array(COLS * ROWS);
    for (let i = 0; i < water.length; i++) water[i] = clearAt(cellPoint(i)) ? 1 : 0;
  }
  return water;
};

/** Shortest way over the grid's open water between two cells (8 neighbours), or null. */
function gridPath(from: number, to: number): number[] | null {
  const open = waterCells();
  const g = new Map<number, number>([[from, 0]]);
  const came = new Map<number, number>();
  const queue: { c: number; f: number }[] = [{ c: from, f: 0 }];
  const goal = cellPoint(to);
  const h = (c: number): number => {
    const p = cellPoint(c);
    return Math.hypot(p.x - goal.x, p.z - goal.z);
  };
  const done = new Set<number>();
  while (queue.length > 0) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if ((queue[i] as { f: number }).f < (queue[bi] as { f: number }).f) bi = i;
    const { c } = queue.splice(bi, 1)[0] as { c: number };
    if (c === to) {
      const out = [c];
      let at = c;
      while (came.has(at)) {
        at = came.get(at) as number;
        out.push(at);
      }
      return out.reverse();
    }
    if (done.has(c)) continue;
    done.add(c);
    const cx = c % COLS;
    const cz = Math.floor(c / COLS);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= COLS || nz >= ROWS) continue;
        const n = nz * COLS + nx;
        if (!open[n] && n !== to) continue;
        const cost = (g.get(c) as number) + (dx !== 0 && dz !== 0 ? 1.414 : 1) * CELL;
        if (cost < (g.get(n) ?? Infinity)) {
          g.set(n, cost);
          came.set(n, c);
          queue.push({ c: n, f: cost + h(n) });
        }
      }
    }
  }
  return null;
}

/**
 * The sea lane from one berth to another: the straight line when it is open water, else the shortest way over open water,
 * pulled tight (every waypoint the line of sight from the one before can reach). It starts and ends at the berths; when
 * nothing is found it is the straight line.
 */
export function routeBetween(from: Port, to: Port): Point[] {
  const a = berthOf(from);
  const b = berthOf(to);
  if (lineClear(a, b)) return [a, b];
  const cells = gridPath(cellOf(a), cellOf(b));
  if (!cells) return [a, b];
  const pts = [a, ...cells.slice(1, -1).map(cellPoint), b];
  const out = [a];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineClear(pts[i] as Point, pts[j] as Point)) j--;
    out.push(pts[j] as Point);
    i = j;
  }
  return out;
}

interface Leg {
  points: Point[];
  /** Cumulative lengths of the polyline (m) and its total. */
  cum: number[];
  length: number;
  /** Seconds sailing it. */
  sail: number;
}

interface Ship {
  line: TrafficLine;
  legs: Leg[];
  cycle: number;
  nation: string;
  /** The direction each port's bow points at the berth (to the sea). */
  heading: number[];
}

function makeLeg(from: Port, to: Port): Leg {
  const points = routeBetween(from, to);
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push((cum[i - 1] as number) + Math.hypot((points[i] as Point).x - (points[i - 1] as Point).x, (points[i] as Point).z - (points[i - 1] as Point).z));
  const length = cum[cum.length - 1] as number;
  return { points, cum, length, sail: length / TRAFFIC.speed };
}

function makeShip(line: TrafficLine): Ship | null {
  const ports = line.calls.map((id) => getPort(id)).filter((p): p is Port => !!p);
  if (ports.length < 2) return null;
  const legs = ports.map((p, i) => makeLeg(p, ports[(i + 1) % ports.length] as Port));
  const cycle = legs.reduce((s, l) => s + l.sail + TRAFFIC.dwell, 0);
  const nation = (ports[0] as Port).nation === 'pirate' ? 'free' : (ports[0] as Port).nation;
  // the bow points out to sea, in the heading convention (cos ψ, -sin ψ): outward is (cos φ, sin φ) in (x, z)
  return { line, legs, cycle, nation, heading: ports.map((p) => -p.outward) };
}

/** Where a merchant is `t` seconds into its round: position, heading, and whether it is under way. */
function trafficAt(ship: Ship, t: number): { x: number; z: number; heading: number; moving: boolean } {
  let rest = ((t % ship.cycle) + ship.cycle) % ship.cycle;
  for (let n = 0; n < ship.legs.length; n++) {
    const leg = ship.legs[n] as Leg;
    if (rest < leg.sail) {
      const s = (rest / leg.sail) * leg.length;
      let i = 1;
      while (i < leg.cum.length - 1 && (leg.cum[i] as number) < s) i++;
      const a = leg.points[i - 1] as Point;
      const b = leg.points[i] as Point;
      const segLen = (leg.cum[i] as number) - (leg.cum[i - 1] as number) || 1;
      const f = (s - (leg.cum[i - 1] as number)) / segLen;
      // heading follows (cos ψ, -sin ψ)
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, heading: Math.atan2(-(b.z - a.z), b.x - a.x), moving: true };
    }
    rest -= leg.sail;
    if (rest < TRAFFIC.dwell) {
      const last = leg.points[leg.points.length - 1] as Point;
      const next = ship.heading[(n + 1) % ship.heading.length] as number;
      return { x: last.x, z: last.z, heading: next, moving: false };
    }
    rest -= TRAFFIC.dwell;
  }
  const p = (ship.legs[0] as Leg).points[0] as Point;
  return { x: p.x, z: p.z, heading: 0, moving: false };
}

/** The trading ships: their positions are a function of time, so the traffic is deterministic and a save needs no part of it. */
export function createTraffic(): { count: number; views(time: number, wind: WindView, firstId: number): OtherShipView[] } {
  const ships = TRAFFIC_LINES.map(makeShip).filter((s): s is Ship => !!s);
  return {
    count: ships.length,
    views(time, wind, firstId): OtherShipView[] {
      return ships.map((s, i) => {
        // each ship starts a different way into its round
        const at = trafficAt(s, time + (i * s.cycle) / ships.length);
        return {
          id: firstId + i,
          specId: s.line.specId,
          nation: s.nation,
          x: at.x,
          z: at.z,
          heading: at.heading,
          sailLevel: at.moving ? 0.8 : 0,
          roll: 0.03 * Math.sin(0.6 * time + i),
          apparent: apparentView(wind, at.heading, at.moving ? TRAFFIC.speed : 0),
        };
      });
    },
  };
}

/** Every port a line calls at exists (for tests and for a data error to show up early). */
export const trafficPortsKnown = (): boolean => TRAFFIC_LINES.every((l) => l.calls.every((c) => PORTS.some((p) => p.id === c)));
