import { PORTS, fbm, hash2, terrainHeight, type Island, type Port } from '../world';

/** One prop of the world kit placed on the map. `yaw` turns the prop's +X (the front of a building) about Y. */
export interface Placement {
  prop: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** Brightness multiplier (instance colour) so no two trees or houses look cut from one block. */
  tint: number;
}

/** Radius (m) each prop keeps clear, for rejection sampling. */
const RADIUS: Record<string, number> = {
  HouseEnglish: 5, HouseFrench: 5, HouseSpanish: 5.5, HouseDutch: 5, Shack: 4, Tavern: 5.5, Warehouse: 8, Church: 8,
  Fort: 17, Lighthouse: 4, Windmill: 5, Crane: 4, MarketStall: 2.6, WatchTower: 3, BarrelStack: 1.6, CrateStack: 1.8,
};

/** What each nation builds its houses of (and what else its towns have). */
const STYLE: Record<string, { houses: string[]; count: number; extra: string[] }> = {
  english: { houses: ['HouseEnglish', 'HouseEnglish', 'HouseEnglish', 'Tavern'], count: 9, extra: ['Church', 'Warehouse'] },
  french: { houses: ['HouseFrench', 'HouseFrench', 'HouseFrench', 'Tavern'], count: 9, extra: ['Church', 'Warehouse'] },
  spanish: { houses: ['HouseSpanish', 'HouseSpanish', 'HouseSpanish', 'Tavern'], count: 10, extra: ['Church', 'Warehouse'] },
  dutch: { houses: ['HouseDutch', 'HouseDutch', 'HouseDutch', 'Tavern'], count: 9, extra: ['Warehouse', 'Windmill'] },
  pirate: { houses: ['Shack', 'Shack', 'Shack', 'Tavern'], count: 8, extra: ['WatchTower'] },
  free: { houses: ['Shack', 'Shack', 'Shack'], count: 7, extra: ['WatchTower'] },
};

/** Ports that also have a fort or a lighthouse on their headland. */
const FORTS = new Set(['redmond', 'falaise-de-fleur', 'quebradas-costillas', 'douwesen']);
const LIGHTHOUSES = new Set(['douwesen', 'falaise-de-fleur', 'conceicao']);

const hasRoom = (placed: Placement[], x: number, z: number, r: number): boolean =>
  placed.every((p) => Math.hypot(p.x - x, p.z - z) > r + (RADIUS[p.prop] ?? 2));

/**
 * The buildings, pier, boats and harbour clutter of one port town, in the style of its nation. Deterministic (the same
 * port always gives the same town) and pure, so tests can check it without WebGL.
 */
export function planTown(port: Port, height: (x: number, z: number) => number = terrainHeight): Placement[] {
  const out: Placement[] = [];
  const seed = port.id.length * 31 + port.id.charCodeAt(0);
  const rnd = (k: number, j = 0): number => hash2(k, j, seed);
  const dir = { x: Math.cos(port.outward), z: Math.sin(port.outward) };
  const side = { x: -dir.z, z: dir.x };
  const yawSea = -port.outward; // a building's front (+X) toward the sea
  const style = STYLE[port.nation] ?? (STYLE.english as (typeof STYLE)[string]);
  const at = (across: number, back: number): { x: number; z: number } => ({
    x: port.town.x + side.x * across - dir.x * back,
    z: port.town.z + side.z * across - dir.z * back,
  });
  const add = (prop: string, x: number, z: number, yaw: number, scale = 1, y = height(x, z)): void => {
    out.push({ prop, x, y, z, yaw, scale, tint: 0.92 + rnd(out.length, 9) * 0.16 });
  };
  /** The first free spot of `tries` candidates between the bounds; returns false when none is. */
  const place = (prop: string, across: [number, number], back: [number, number], k0: number, landMin = 1.8, landMax = 16): boolean => {
    const r = RADIUS[prop] ?? 4;
    for (let k = 0; k < 40; k++) {
      const p = at(across[0] + rnd(k0 + k, 1) * (across[1] - across[0]), back[0] + rnd(k0 + k, 2) * (back[1] - back[0]));
      const h = height(p.x, p.z);
      if (h < landMin || h > landMax) continue;
      // reasonably level ground
      if (Math.abs(height(p.x + 3, p.z) - h) + Math.abs(height(p.x, p.z + 3) - h) > 3.2) continue;
      if (!hasRoom(out, p.x, p.z, r)) continue;
      add(prop, p.x, p.z, yawSea + (rnd(k0 + k, 3) - 0.5) * 0.35, 0.92 + rnd(k0 + k, 4) * 0.2, h);
      return true;
    }
    return false;
  };

  // the headland defences first, so nothing is built into them
  if (FORTS.has(port.id)) {
    for (const s of [1, -1]) if (place('Fort', [s * 48, s * 70], [-6, 8], 700 + s * 31, 2.5, 30)) break;
  }
  if (LIGHTHOUSES.has(port.id)) {
    for (const s of [-1, 1]) if (place('Lighthouse', [s * 60, s * 90], [-16, 4], 800 + s * 17, 1.4, 20)) break;
  }
  // the big buildings, then the houses around them
  for (const [i, prop] of style.extra.entries()) place(prop, [-26, 26], [8, 52], 100 + i * 50, 2, 18);
  for (let i = 0; i < style.count; i++) place(style.houses[i % style.houses.length] as string, [-38, 38], [0, 56], 200 + i * 40);
  for (let i = 0; i < 3; i++) place('MarketStall', [-10, 10], [-4, 8], 400 + i * 20);
  for (let i = 0; i < 2; i++) place(i ? 'BarrelStack' : 'CrateStack', [-24, 24], [-6, 4], 500 + i * 20, 1.5);

  // the pier from the coast out over the water, a crane at its landward end, boats alongside
  const reach = Math.hypot(port.anchor.x - port.coast.x, port.anchor.z - port.coast.z) * 0.45 + 20;
  const planks = Math.max(2, Math.ceil(reach / 8));
  for (let i = 0; i < planks; i++) {
    const d = -2 + i * 8;
    add('PierPlank', port.coast.x + dir.x * d, port.coast.z + dir.z * d, yawSea + Math.PI / 2, 1, 0);
  }
  const crane = { x: port.coast.x + side.x * 4.2 + dir.x * 4, z: port.coast.z + side.z * 4.2 + dir.z * 4 };
  if (height(crane.x, crane.z) < 2.5) add('Crane', crane.x, crane.z, yawSea, 1, 0.9);
  const boats = ['Rowboat', 'FishingBoat', 'Rowboat', 'Canoe'];
  for (let i = 0; i < boats.length; i++) {
    const d = 12 + i * 11;
    const s = i % 2 ? 7.5 : -7.5;
    const x = port.coast.x + dir.x * d + side.x * s;
    const z = port.coast.z + dir.z * d + side.z * s;
    if (height(x, z) < -1.2) add(boats[i] as string, x, z, yawSea + (rnd(i, 7) - 0.5) * 0.5 + (i % 2 ? Math.PI : 0), 1, -0.3);
  }
  return out;
}

/** The trees, bushes and rocks of an island, kept clear of its port towns. */
export function planNature(island: Island, height: (x: number, z: number) => number = terrainHeight): Placement[] {
  const out: Placement[] = [];
  const towns = PORTS.filter((p) => p.islandId === island.id);
  const step = 11;
  const half = island.radius * 1.4;
  for (let z = island.z - half; z < island.z + half; z += step) {
    for (let x = island.x - half; x < island.x + half; x += step) {
      const k = Math.floor(x) * 7 + Math.floor(z) * 13;
      const jx = x + (hash2(Math.floor(x), Math.floor(z), island.seed) - 0.5) * step;
      const jz = z + (hash2(Math.floor(z), Math.floor(x), island.seed + 1) - 0.5) * step;
      const h = height(jx, jz);
      if (h < 0.8 || h > 62) continue;
      if (towns.some((t) => Math.hypot(t.town.x - jx, t.town.z - jz) < 52 || Math.hypot(t.coast.x - jx, t.coast.z - jz) < 22)) continue;
      const slope = Math.abs(height(jx + 3, jz) - h) + Math.abs(height(jx, jz + 3) - h);
      const roll = hash2(k, 5, island.seed);
      const grove = fbm(jx * 0.02, jz * 0.02, island.seed + 7, 2);
      let prop: string | null = null;
      if (h < 6 && slope < 4.5) prop = roll < 0.42 ? (roll < 0.21 ? 'PalmA' : 'PalmB') : roll < 0.5 ? 'Bush' : null;
      else if (h < 28 && slope < 6) prop = grove > 0.38 ? (roll < 0.55 ? 'Broadleaf' : roll < 0.7 ? 'Bush' : null) : roll < 0.08 ? 'Bush' : null;
      else if (h < 52 && slope < 7) prop = grove > 0.36 ? (roll < 0.5 ? 'Pine' : roll < 0.62 ? 'Bush' : null) : null;
      if (h > 36 && slope > 3 && roll > 0.9) prop = ['RockA', 'RockB', 'RockC'][Math.floor(hash2(k, 6, 3) * 3)] as string;
      if (h < 3 && roll > 0.93) prop = ['RockA', 'RockB', 'RockC'][Math.floor(hash2(k, 7, 3) * 3)] as string;
      if (!prop) continue;
      out.push({ prop, x: jx, y: h - 0.15, z: jz, yaw: hash2(k, 8, 1) * Math.PI * 2, scale: 0.75 + hash2(k, 9, island.seed) * 0.6, tint: 0.88 + hash2(k, 10, 2) * 0.22 });
    }
  }
  return out;
}

