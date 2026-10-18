import { fbm } from './noise';

/**
 * The archipelago. Layout follows the original game's map (GameFAQs "Data Tables"
 * guide): the world is a grid of islands, north up (north is -z), scaled so that
 * neighbours are roughly 0.9 km apart: 1–2 minutes of sailing.
 */
export interface PortDef {
  id: string;
  name: string;
  /** Direction from the island centre to the port, radians in the (x, z) plane. */
  angle: number;
  description: string;
}

export interface Island {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Nominal radius in metres; the coast is noisy around it. */
  radius: number;
  /** Peak height in metres. */
  peak: number;
  seed: number;
  ports: readonly PortDef[];
}

export const ISLANDS: readonly Island[] = [
  {
    id: 'conceicao', name: 'Conceicao', x: -1560, z: -900, radius: 250, peak: 50, seed: 11,
    ports: [
      { id: 'conceicao', name: 'Conceicao', angle: 0.5, description: 'Sakin bir koy kasabası; tersane ve diplomat.' },
      { id: 'conceicao-smugglers', name: 'Conceicao Smugglers', angle: 3.9, description: 'Kayaların arkasına saklanmış kaçakçı limanı.' },
    ],
  },
  {
    id: 'falaise', name: 'Falaise de Fleur', x: -650, z: -900, radius: 230, peak: 70, seed: 23,
    ports: [{ id: 'falaise-de-fleur', name: 'Falaise de Fleur', angle: 1.3, description: 'Beyaz kayalıkların altında bir Fransız limanı.' }],
  },
  {
    id: 'redmond', name: 'Redmond', x: 650, z: -900, radius: 270, peak: 60, seed: 37,
    ports: [{ id: 'redmond', name: 'Redmond', angle: 2.1, description: 'Kalabalık bir ticaret kenti ve garnizon.' }],
  },
  {
    id: 'muelle', name: 'Isla Muelle', x: -1170, z: 0, radius: 220, peak: 45, seed: 41,
    ports: [{ id: 'isla-muelle', name: 'Isla Muelle', angle: -0.6, description: 'İskeleleriyle ünlü küçük bir ada limanı.' }],
  },
  {
    id: 'douwesen', name: 'Douwesen', x: -260, z: 0, radius: 280, peak: 65, seed: 53,
    ports: [
      { id: 'douwesen', name: 'Douwesen', angle: 1.6, description: 'Hollanda ticaret üssü; ambarlar ve tüccarlar.' },
      { id: 'douwesen-pirates', name: 'Douwesen Pirates', angle: -2.4, description: 'Adanın arka yüzündeki korsan sığınağı.' },
    ],
  },
  {
    id: 'oxbay', name: 'Oxbay & Greenford', x: 650, z: 0, radius: 300, peak: 75, seed: 67,
    ports: [
      { id: 'oxbay', name: 'Oxbay', angle: 3.0, description: 'Batıya bakan İngiliz limanı.' },
      { id: 'greenford', name: 'Greenford', angle: 0.2, description: 'Şeker ve rom taşıyan yeşil bir liman.' },
    ],
  },
  {
    id: 'quebradas', name: 'Quebradas Costillas', x: 650, z: 900, radius: 240, peak: 80, seed: 79,
    ports: [{ id: 'quebradas-costillas', name: 'Quebradas Costillas', angle: -1.4, description: 'Dik kayalıkların arasında bir İspanyol limanı.' }],
  },
  {
    id: 'khoal', name: 'Khoal Roa', x: 1820, z: 900, radius: 260, peak: 55, seed: 89,
    ports: [{ id: 'khoal-roa', name: 'Khoal Roa', angle: 3.3, description: 'Uzak doğudaki yerli köyü ve ticaret noktası.' }],
  },
];

const COAST_LEVEL = 0.2;
/** Sea floor gradient off the coast, metres of depth per unit of normalised distance. */
const SHELF_SLOPE = 30;
const FLOOR = -60;

function islandHeight(i: Island, x: number, z: number): number {
  const dx = x - i.x;
  const dz = z - i.z;
  if (dx * dx + dz * dz > (i.radius * 2.2) ** 2) return FLOOR;
  const u = Math.hypot(dx, dz) / i.radius;
  const n = fbm(x * 0.006, z * 0.006, i.seed, 4);
  const shape = 1 - u + (n - 0.5) * 0.7;
  if (shape <= COAST_LEVEL) return Math.max(FLOOR, -(COAST_LEVEL - shape) * SHELF_SLOPE);
  const t = (shape - COAST_LEVEL) / (1 - COAST_LEVEL);
  // Gentle beach, then a steepening slope up to the peak.
  return i.peak * (0.18 * t + 0.82 * t ** 2.2);
}

/** Height of land above sea level in metres; negative is the depth of the water. */
export function terrainHeight(x: number, z: number): number {
  let h = FLOOR;
  for (const i of ISLANDS) {
    const v = islandHeight(i, x, z);
    if (v > h) h = v;
  }
  return h;
}

/** World extent covering every island with a margin, for maps and textures. */
export const WORLD_BOUNDS = (() => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const i of ISLANDS) {
    minX = Math.min(minX, i.x - i.radius * 1.6);
    maxX = Math.max(maxX, i.x + i.radius * 1.6);
    minZ = Math.min(minZ, i.z - i.radius * 1.6);
    maxZ = Math.max(maxZ, i.z + i.radius * 1.6);
  }
  return { minX, maxX, minZ, maxZ };
})();
