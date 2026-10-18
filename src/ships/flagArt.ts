import * as THREE from 'three';

/**
 * Ensign art: one canvas texture per nation (`english`, `french`, `spanish`, `dutch`, `pirate`, `free`), drawn with
 * paths so there are no image files. Layout of every texture (flag cloth UVs are set to match in `flagCloth.ts`):
 * the flag fills the upper `FLAG_V0`…1 of the height with its hoist on the left; the strip below is one plain colour
 * (`pennantColor`) that the thin masthead pennants sample.
 */
export const ENSIGNS = ['free', 'english', 'french', 'spanish', 'dutch', 'pirate'] as const;
export type Ensign = (typeof ENSIGNS)[number];

/** v of the bottom of the flag proper; below it lies the pennant strip. */
export const FLAG_V0 = 0.12;
/** v at which a pennant samples the strip's plain colour. */
export const PENNANT_V = 0.05;

const W = 320;
const H = 200;
const FLAG_H = Math.round(H * (1 - FLAG_V0));

const COLORS: Record<Ensign, string> = {
  free: '#efe6cc',
  english: '#c0392b',
  french: '#f4f1e6',
  spanish: '#f4f1e6',
  dutch: '#e8672c',
  pirate: '#151515',
};

type Ctx = CanvasRenderingContext2D;

function rect(ctx: Ctx, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Red Ensign: a red field with the Union Jack in the canton. */
function english(ctx: Ctx): void {
  rect(ctx, '#c0392b', 0, 0, W, FLAG_H);
  const cw = W * 0.5;
  const ch = FLAG_H * 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cw, ch);
  ctx.clip();
  rect(ctx, '#1f3a7a', 0, 0, cw, ch);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#f4f1e6';
  ctx.lineWidth = ch * 0.2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(cw, ch);
  ctx.moveTo(cw, 0);
  ctx.lineTo(0, ch);
  ctx.stroke();
  ctx.strokeStyle = '#c0392b';
  ctx.lineWidth = ch * 0.08;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(cw, ch);
  ctx.moveTo(cw, 0);
  ctx.lineTo(0, ch);
  ctx.stroke();
  rect(ctx, '#f4f1e6', 0, ch * 0.5 - ch * 0.17, cw, ch * 0.34);
  rect(ctx, '#f4f1e6', cw * 0.5 - cw * 0.1, 0, cw * 0.2, ch);
  rect(ctx, '#c0392b', 0, ch * 0.5 - ch * 0.09, cw, ch * 0.18);
  rect(ctx, '#c0392b', cw * 0.5 - cw * 0.05, 0, cw * 0.1, ch);
  ctx.restore();
}

/** A simple fleur-de-lis centred on (x, y), `s` px tall. */
function fleur(ctx: Ctx, x: number, y: number, s: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.5);
  ctx.quadraticCurveTo(x + s * 0.2, y - s * 0.2, x, y + s * 0.15);
  ctx.quadraticCurveTo(x - s * 0.2, y - s * 0.2, x, y - s * 0.5);
  ctx.fill();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + side * s * 0.05, y + s * 0.12);
    ctx.quadraticCurveTo(x + side * s * 0.5, y - s * 0.25, x + side * s * 0.38, y + s * 0.02);
    ctx.quadraticCurveTo(x + side * s * 0.32, y + s * 0.2, x + side * s * 0.12, y + s * 0.22);
    ctx.fill();
  }
  ctx.fillRect(x - s * 0.22, y + s * 0.2, s * 0.44, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(x - s * 0.1, y + s * 0.27);
  ctx.lineTo(x, y + s * 0.5);
  ctx.lineTo(x + s * 0.1, y + s * 0.27);
  ctx.fill();
}

/** Bourbon colours: a white field with gold fleurs-de-lis. */
function french(ctx: Ctx): void {
  rect(ctx, '#f4f1e6', 0, 0, W, FLAG_H);
  ctx.strokeStyle = '#1f3f8f';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, W - 8, FLAG_H - 8);
  const s = FLAG_H * 0.3;
  for (const [fx, fy] of [[0.25, 0.3], [0.5, 0.3], [0.75, 0.3], [0.375, 0.7], [0.625, 0.7]] as const) fleur(ctx, W * fx, FLAG_H * fy, s, '#d7a81d');
}

/** Cross of Burgundy: a white field with a red ragged saltire. */
function spanish(ctx: Ctx): void {
  rect(ctx, '#f4f1e6', 0, 0, W, FLAG_H);
  ctx.strokeStyle = '#b3201f';
  ctx.lineCap = 'round';
  ctx.lineWidth = FLAG_H * 0.1;
  ctx.beginPath();
  ctx.moveTo(W * 0.12, FLAG_H * 0.1);
  ctx.lineTo(W * 0.88, FLAG_H * 0.9);
  ctx.moveTo(W * 0.88, FLAG_H * 0.1);
  ctx.lineTo(W * 0.12, FLAG_H * 0.9);
  ctx.stroke();
  ctx.lineWidth = FLAG_H * 0.045;
  for (const [x1, y1, x2, y2] of [[0.3, 0.3, 0.38, 0.12], [0.7, 0.3, 0.62, 0.12], [0.3, 0.7, 0.38, 0.88], [0.7, 0.7, 0.62, 0.88]] as const) {
    ctx.beginPath();
    ctx.moveTo(W * x1, FLAG_H * y1);
    ctx.lineTo(W * x2, FLAG_H * y2);
    ctx.stroke();
  }
  ctx.strokeStyle = '#d7a81d';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, FLAG_H - 6);
}

/** Prinsenvlag: orange, white, blue stripes. */
function dutch(ctx: Ctx): void {
  const stripe = FLAG_H / 3;
  rect(ctx, '#e8672c', 0, 0, W, stripe + 1);
  rect(ctx, '#f4f1e6', 0, stripe, W, stripe + 1);
  rect(ctx, '#21468b', 0, stripe * 2, W, stripe + 1);
}

/** Jolly Roger: a white skull over crossed bones on black. */
function pirate(ctx: Ctx): void {
  rect(ctx, '#151515', 0, 0, W, FLAG_H);
  const cx = W / 2;
  const cy = FLAG_H * 0.5;
  ctx.strokeStyle = '#efe9da';
  ctx.lineCap = 'round';
  ctx.lineWidth = FLAG_H * 0.07;
  ctx.beginPath();
  ctx.moveTo(cx - W * 0.2, cy + FLAG_H * 0.3);
  ctx.lineTo(cx + W * 0.2, cy - FLAG_H * 0.05);
  ctx.moveTo(cx + W * 0.2, cy + FLAG_H * 0.3);
  ctx.lineTo(cx - W * 0.2, cy - FLAG_H * 0.05);
  ctx.stroke();
  for (const [bx, by] of [[-0.2, 0.3], [0.2, 0.3], [-0.2, -0.05], [0.2, -0.05]] as const) {
    ctx.beginPath();
    ctx.arc(cx + W * bx, cy + FLAG_H * by, FLAG_H * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = '#efe9da';
    ctx.fill();
  }
  ctx.fillStyle = '#efe9da';
  ctx.beginPath();
  ctx.ellipse(cx, cy - FLAG_H * 0.1, FLAG_H * 0.22, FLAG_H * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - FLAG_H * 0.12, cy + FLAG_H * 0.05, FLAG_H * 0.24, FLAG_H * 0.12);
  ctx.fillStyle = '#151515';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * FLAG_H * 0.09, cy - FLAG_H * 0.12, FLAG_H * 0.055, FLAG_H * 0.065, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy - FLAG_H * 0.03);
  ctx.lineTo(cx - FLAG_H * 0.03, cy + FLAG_H * 0.03);
  ctx.lineTo(cx + FLAG_H * 0.03, cy + FLAG_H * 0.03);
  ctx.fill();
  for (let i = -1; i <= 1; i++) ctx.fillRect(cx + i * FLAG_H * 0.06 - 1.5, cy + FLAG_H * 0.06, 3, FLAG_H * 0.1);
}

/** A free captain: a cream field, a navy border and a navy anchor. */
function free(ctx: Ctx): void {
  rect(ctx, '#efe6cc', 0, 0, W, FLAG_H);
  ctx.strokeStyle = '#1f3a5a';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, W - 8, FLAG_H - 8);
  ctx.lineCap = 'round';
  ctx.lineWidth = FLAG_H * 0.06;
  const cx = W / 2;
  const cy = FLAG_H / 2;
  const r = FLAG_H * 0.3;
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.95, r * 0.2, 0, Math.PI * 2);
  ctx.moveTo(cx, cy - r * 0.72);
  ctx.lineTo(cx, cy + r * 0.9);
  ctx.moveTo(cx - r * 0.4, cy - r * 0.4);
  ctx.lineTo(cx + r * 0.4, cy - r * 0.4);
  ctx.moveTo(cx - r * 0.85, cy + r * 0.2);
  ctx.quadraticCurveTo(cx - r * 0.75, cy + r * 1.05, cx, cy + r * 0.9);
  ctx.quadraticCurveTo(cx + r * 0.75, cy + r * 1.05, cx + r * 0.85, cy + r * 0.2);
  ctx.stroke();
}

const ART: Record<Ensign, (ctx: Ctx) => void> = { free, english, french, spanish, dutch, pirate };

const cache = new Map<string, THREE.CanvasTexture>();

/** Is `id` an ensign the art knows? */
export const isEnsign = (id: string | undefined): id is Ensign => !!id && (ENSIGNS as readonly string[]).includes(id);

/** The shared texture of an ensign (never disposed by a ship: every ship of the nation uses the same one). */
export function ensignTexture(id: Ensign): THREE.CanvasTexture {
  const hit = cache.get(id);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    rect(ctx, COLORS[id], 0, 0, W, H); // the plain pennant strip (and a safe ground)
    ctx.save();
    ART[id](ctx);
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(id, t);
  return t;
}
