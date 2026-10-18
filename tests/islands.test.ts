import { describe, expect, it } from 'vitest';
import { ISLANDS, PORTS, WORLD_BOUNDS, getPort, hash2, terrainHeight, valueNoise } from '../src/world';

const GUIDE_PORTS = [
  'Redmond', 'Greenford', 'Oxbay', 'Falaise de Fleur', 'Conceicao', 'Conceicao Smugglers',
  'Quebradas Costillas', 'Isla Muelle', 'Douwesen', 'Douwesen Pirates', 'Khoal Roa',
];

describe('noise', () => {
  it('is deterministic, in range and continuous', () => {
    expect(hash2(3, -7, 5)).toBe(hash2(3, -7, 5));
    expect(hash2(3, -7, 5)).not.toBe(hash2(3, -7, 6));
    for (let i = 0; i < 200; i++) {
      const v = valueNoise(i * 0.37, i * -0.91, 9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(valueNoise(10.001, 4, 1) - valueNoise(10, 4, 1))).toBeLessThan(0.01);
  });
});

describe('archipelago', () => {
  it('has every port from the original map, once each, on 8 islands', () => {
    expect(PORTS.map((p) => p.name).sort()).toEqual([...GUIDE_PORTS].sort());
    expect(ISLANDS).toHaveLength(8);
    for (const i of ISLANDS) expect(i.ports.length).toBeGreaterThan(0);
  });

  it('keeps islands apart so there is open water between them', () => {
    for (const a of ISLANDS) {
      for (const b of ISLANDS) {
        if (a.id >= b.id) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan((a.radius + b.radius) * 1.4);
      }
    }
  });

  it('rises from sea to a peak on every island and is deep sea far away', () => {
    for (const i of ISLANDS) {
      expect(terrainHeight(i.x, i.z)).toBeGreaterThan(i.peak * 0.4);
    }
    expect(terrainHeight(WORLD_BOUNDS.minX - 500, 0)).toBeLessThan(-30);
  });

  it('places every port with a town on land and a deep-water anchorage', () => {
    for (const p of PORTS) {
      expect(terrainHeight(p.town.x, p.town.z), `${p.id} town`).toBeGreaterThan(0.5);
      expect(terrainHeight(p.coast.x, p.coast.z), `${p.id} coast`).toBeLessThan(0.5);
      // Deeper than the 9 m anchorage rule, so even the Battleship (5.5 m draft + 0.5 m margin) clears it.
      for (const [dx, dz] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]] as const) {
        expect(terrainHeight(p.anchor.x + dx, p.anchor.z + dz), `${p.id} anchorage`).toBeLessThan(-9);
      }
    }
    expect(getPort('douwesen')?.name).toBe('Douwesen');
  });

  it('keeps ports on one island at least 150 m apart', () => {
    for (const a of PORTS) {
      for (const b of PORTS) {
        if (a.id >= b.id || a.islandId !== b.islandId) continue;
        expect(Math.hypot(a.town.x - b.town.x, a.town.z - b.town.z)).toBeGreaterThan(150);
      }
    }
  });
});
