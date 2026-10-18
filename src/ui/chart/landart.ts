import { hash2, terrainHeight, type Island } from '../../world';
import { INK } from './parchment';

/** Metres per pixel of the island pictures on the chart. */
export const LAND_RES = 2.5;

export interface LandArt {
  canvas: HTMLCanvasElement;
  /** The picture covers the island centre ± `half` metres on both axes. */
  half: number;
}

type Rgb = [number, number, number];

/** Muted hand-coloured palette: beach, lowland, upland, rock. */
const BANDS: [number, Rgb][] = [
  [0, [232, 214, 160]],
  [2.5, [206, 200, 134]],
  [14, [170, 176, 112]],
  [34, [150, 150, 100]],
  [52, [150, 132, 102]],
];

function landColor(h: number): Rgb {
  let lo = BANDS[0] as [number, Rgb];
  for (const band of BANDS) {
    if (h >= band[0]) lo = band;
  }
  const next = BANDS[BANDS.indexOf(lo) + 1];
  if (!next) return lo[1];
  const t = Math.min(Math.max((h - lo[0]) / (next[0] - lo[0]), 0), 1);
  return [lo[1][0] + (next[1][0] - lo[1][0]) * t, lo[1][1] + (next[1][1] - lo[1][1]) * t, lo[1][2] + (next[1][2] - lo[1][2]) * t];
}

/**
 * An island as an old chart draws it: tinted land lit from the north-west, an ink coastline, trees on the lowlands,
 * hachure marks on the peaks and, around it, the shallows with two depth contours.
 */
export function buildLandArt(island: Island): LandArt {
  const half = island.radius * 1.6;
  const size = Math.ceil((half * 2) / LAND_RES);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, half };

  const stride = size + 2;
  const hs = new Float32Array(stride * stride); // one pixel of padding for the slope and the coast tests
  const at = (i: number, j: number): number => hs[(j + 1) * stride + (i + 1)] as number;
  for (let j = -1; j <= size; j++) {
    for (let i = -1; i <= size; i++) {
      hs[(j + 1) * stride + (i + 1)] = terrainHeight(island.x - half + (i + 0.5) * LAND_RES, island.z - half + (j + 0.5) * LAND_RES);
    }
  }

  const img = ctx.createImageData(size, size);
  const ink: Rgb = [58, 42, 18];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h = at(i, j);
      const o = (j * size + i) * 4;
      if (h >= 0) {
        const [r, g, b] = landColor(h);
        // light from the north-west: slope towards the light brightens, away darkens
        const slope = (at(i + 1, j + 1) - at(i - 1, j - 1)) / (2 * LAND_RES);
        const shade = Math.min(Math.max(1 - slope * 2.2, 0.62), 1.28);
        let rr = r * shade;
        let gg = g * shade;
        let bb = b * shade;
        const coast = at(i - 1, j) < 0 || at(i + 1, j) < 0 || at(i, j - 1) < 0 || at(i, j + 1) < 0;
        if (coast) {
          rr = ink[0];
          gg = ink[1];
          bb = ink[2];
        }
        img.data.set([rr, gg, bb, 255], o);
      } else if (h > -12) {
        // shallows: pale blue-green wash fading with depth, and two contour lines
        const wash = 1 + h / 12;
        let a = 120 * wash;
        let r = 120;
        let g = 178;
        let b = 178;
        if (Math.abs(h + 3.2) < 0.22 || Math.abs(h + 8) < 0.2) {
          r = 70;
          g = 120;
          b = 140;
          a = 190;
        }
        img.data.set([r, g, b, a], o);
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  // trees on the lowlands, hachures on the peaks
  ctx.lineCap = 'round';
  for (let j = 3; j < size - 3; j += 5) {
    for (let i = 3; i < size - 3; i += 5) {
      const h = at(i, j);
      if (h < 3.5) continue;
      const r = hash2(i, j, island.seed);
      const x = i + (hash2(i, j, 31) - 0.5) * 4;
      const y = j + (hash2(i, j, 32) - 0.5) * 4;
      if (h < island.peak * 0.62 && r < 0.3) {
        ctx.fillStyle = 'rgba(66, 98, 52, 0.9)';
        ctx.beginPath();
        ctx.arc(x, y, 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(40, 62, 30, 0.8)';
        ctx.fillRect(x - 0.4, y + 1.4, 0.8, 1.4);
      } else if (h >= island.peak * 0.62 && r < 0.22) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(x - 3.5, y + 2.5);
        ctx.lineTo(x, y - 3);
        ctx.lineTo(x + 3.5, y + 2.5);
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x + 1.4, y + 2.5);
        ctx.stroke();
      }
    }
  }
  return { canvas, half };
}
