import { describe, expect, it } from 'vitest';
import { PATROL_CLEARANCE, avoidanceOffsets, createNpcFleet } from '../src/gameplay/npcShips';
import { getShipSpec } from '../src/ships';

const DT = 1 / 20;

describe('patrol avoidance', () => {
  it('does nothing for ships that are clear of each other', () => {
    const off = avoidanceOffsets([{ x: 0, z: 0, length: 20 }, { x: 500, z: 0, length: 20 }]);
    expect(off).toEqual([[0, 0], [0, 0]]);
  });

  it('pushes two ships that are closing apart along the line between them, equally and growing as they close', () => {
    const near = avoidanceOffsets([{ x: 0, z: 0, length: 20 }, { x: 30, z: 0, length: 20 }]);
    const far = avoidanceOffsets([{ x: 0, z: 0, length: 20 }, { x: 40, z: 0, length: 20 }]);
    expect(near[0]![0]).toBeLessThan(0);
    expect(near[1]![0]).toBeGreaterThan(0);
    expect(near[0]![0]).toBeCloseTo(-near[1]![0]);
    expect(Math.abs(near[0]![0])).toBeGreaterThan(Math.abs(far[0]![0]));
  });

  it('makes a patrol give way wholly to a ship that is not on rails, never more than the cap', () => {
    const off = avoidanceOffsets([{ x: 0, z: 0, length: 20 }], [{ x: 5, z: 0, length: 40 }]);
    expect(off[0]![0]).toBeLessThan(-30);
    expect(Math.hypot(...(off[0] as [number, number]))).toBeLessThanOrEqual(70 + 1e-9);
  });

  it('keeps the whole fleet from running into each other, minute after minute, where the rails alone cross', () => {
    const fleet = createNpcFleet({ x: 0, z: 0 });
    let worstRails = Infinity;
    let worstAvoiding = Infinity;
    for (let i = 0; i < 20 * 60 * 20; i++) {
      fleet.update(DT);
      if (i % 20 !== 0) continue;
      for (const [list, which] of [[fleet.view(), 'rails'], [fleet.view(undefined, []), 'avoiding']] as const) {
        for (let a = 0; a < list.length; a++) {
          for (let b = a + 1; b < list.length; b++) {
            const p = list[a]!;
            const q = list[b]!;
            const touch = ((getShipSpec(p.specId)?.length ?? 20) + (getShipSpec(q.specId)?.length ?? 20)) / 2;
            const gap = Math.hypot(p.x - q.x, p.z - q.z) - touch;
            if (which === 'rails') worstRails = Math.min(worstRails, gap);
            else worstAvoiding = Math.min(worstAvoiding, gap);
          }
        }
      }
    }
    expect(worstRails).toBeLessThan(0); // the rails really do cross: the ships would pass through each other
    expect(worstAvoiding).toBeGreaterThan(-PATROL_CLEARANCE * 0.5); // the clearance holds in all but the tightest squeezes
  });

  it('is deterministic and continuous: nobody jumps between steps', () => {
    const run = (): [number, number][] => {
      const fleet = createNpcFleet({ x: 0, z: 0 });
      const out: [number, number][] = [];
      for (let i = 0; i < 20 * 120; i++) {
        fleet.update(DT);
        const v = fleet.view(undefined, [{ x: 0, z: 40, length: 30 }])[3]!;
        out.push([v.x, v.z]);
      }
      return out;
    };
    const a = run();
    expect(a).toEqual(run());
    for (let i = 1; i < a.length; i++) expect(Math.hypot(a[i]![0] - a[i - 1]![0], a[i]![1] - a[i - 1]![1])).toBeLessThan(5);
  });
});
