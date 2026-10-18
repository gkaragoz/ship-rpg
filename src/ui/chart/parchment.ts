import { fbm, hash2 } from '../../world';

/** Colours shared by the chart's art (ink, sea tints, parchment). */
export const INK = '#3a2a12';
export const INK_SOFT = 'rgba(58, 42, 18, 0.55)';
export const SEA_INK = 'rgba(62, 112, 130, 0.55)';

/**
 * The chart's paper: warm parchment with cloudy stains, fine grain and burnt edges. Drawn once per size into its own
 * canvas (the chart blits it every frame).
 */
export function createParchment(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  // Rendered at a quarter of the resolution for the cloudy part (cheap, smooth), the grain at full resolution below.
  const lw = Math.max(1, Math.ceil(width / 4));
  const lh = Math.max(1, Math.ceil(height / 4));
  const img = ctx.createImageData(lw, lh);
  for (let j = 0; j < lh; j++) {
    for (let i = 0; i < lw; i++) {
      const cloud = fbm(i * 0.045, j * 0.045, 7, 4); // 0..1 blotches
      const fine = fbm(i * 0.2, j * 0.2, 19, 2);
      const t = 0.55 * cloud + 0.45 * fine;
      const r = 226 - 34 * t;
      const g = 206 - 40 * t;
      const b = 160 - 46 * t;
      img.data.set([r, g, b, 255], (j * lw + i) * 4);
    }
  }
  const small = document.createElement('canvas');
  small.width = lw;
  small.height = lh;
  small.getContext('2d')?.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, width, height);

  // fibre grain
  const grain = ctx.getImageData(0, 0, width, height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const n = (hash2(i, j, 5) - 0.5) * 14;
      const o = (j * width + i) * 4;
      grain.data[o] = Math.min(255, Math.max(0, (grain.data[o] as number) + n));
      grain.data[o + 1] = Math.min(255, Math.max(0, (grain.data[o + 1] as number) + n));
      grain.data[o + 2] = Math.min(255, Math.max(0, (grain.data[o + 2] as number) + n));
    }
  }
  ctx.putImageData(grain, 0, 0);

  // burnt edges and a soft vignette
  const edge = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.38, width / 2, height / 2, Math.hypot(width, height) * 0.55);
  edge.addColorStop(0, 'rgba(90, 52, 14, 0)');
  edge.addColorStop(0.7, 'rgba(90, 52, 14, 0.16)');
  edge.addColorStop(1, 'rgba(60, 30, 6, 0.55)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}
