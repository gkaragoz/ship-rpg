import { INK, INK_SOFT } from './parchment';

type Ctx = CanvasRenderingContext2D;

/** A compass rose of `r` px with 16 points, north (K) up, drawn in ink and a little red. */
export function drawCompassRose(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = 'rgba(232, 214, 160, 0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
  ctx.stroke();
  // 16 points: long cardinals, medium intercardinals, short half-winds
  for (let k = 0; k < 16; k++) {
    const len = k % 4 === 0 ? r : k % 2 === 0 ? r * 0.78 : r * 0.55;
    const a = (k * Math.PI) / 8 - Math.PI / 2;
    const w = k % 4 === 0 ? 0.13 : k % 2 === 0 ? 0.1 : 0.07;
    const side = (s: number): [number, number] => [Math.cos(a + s * Math.PI / 2) * r * w, Math.sin(a + s * Math.PI / 2) * r * w];
    const [lx, ly] = side(1);
    const [rx, ry] = side(-1);
    const tip: [number, number] = [Math.cos(a) * len, Math.sin(a) * len];
    ctx.fillStyle = k % 4 === 0 ? (k === 0 ? '#a52a1c' : INK) : k % 2 === 0 ? 'rgba(58, 42, 18, 0.72)' : 'rgba(58, 42, 18, 0.45)';
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(tip[0], tip[1]);
    ctx.lineTo(rx, ry);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = INK;
  ctx.font = `bold ${Math.round(r * 0.26)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lab = r * 1.2;
  ctx.fillText('K', 0, -lab);
  ctx.fillText('G', 0, lab);
  ctx.fillText('D', lab, 0);
  ctx.fillText('B', -lab, 0);
  ctx.restore();
}

/** Faint rhumb lines fanning out of a compass rose, clipped to the map area by the caller. */
export function drawRhumbLines(ctx: Ctx, x: number, y: number, length: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(58, 42, 18, 0.16)';
  ctx.lineWidth = 0.8;
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * length, y + Math.sin(a) * length);
    ctx.stroke();
  }
  ctx.restore();
}

/** Double frame with ticks, and grid letters across the top and numbers down the side (cell = `cell` px). */
export function drawFrame(ctx: Ctx, w: number, h: number, margin: number, cell: { x: number; y: number; px: number; py: number }): void {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.2;
  ctx.strokeRect(margin, margin, w - margin * 2, h - margin * 2);
  ctx.lineWidth = 0.9;
  ctx.strokeRect(margin - 5, margin - 5, w - margin * 2 + 10, h - margin * 2 + 10);
  ctx.fillStyle = INK;
  ctx.font = 'bold 11px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let col = 0;
  for (let x = cell.x; x < w - margin; x += cell.px) {
    if (x > margin) {
      ctx.beginPath();
      ctx.moveTo(x, margin);
      ctx.lineTo(x, margin + 5);
      ctx.moveTo(x, h - margin);
      ctx.lineTo(x, h - margin - 5);
      ctx.stroke();
    }
    const mid = x + cell.px / 2;
    if (mid > margin && mid < w - margin) {
      ctx.fillText(String.fromCharCode(65 + (col % 26)), mid, margin - 11);
      ctx.fillText(String.fromCharCode(65 + (col % 26)), mid, h - margin + 11);
    }
    col++;
  }
  let row = 0;
  for (let y = cell.y; y < h - margin; y += cell.py) {
    if (y > margin) {
      ctx.beginPath();
      ctx.moveTo(margin, y);
      ctx.lineTo(margin + 5, y);
      ctx.moveTo(w - margin, y);
      ctx.lineTo(w - margin - 5, y);
      ctx.stroke();
    }
    const mid = y + cell.py / 2;
    if (mid > margin && mid < h - margin) {
      ctx.fillText(String(row + 1), margin - 11, mid);
      ctx.fillText(String(row + 1), w - margin + 11, mid);
    }
    row++;
  }
  ctx.restore();
}

/** A scroll-like title cartouche with `title` and a smaller `sub` line. */
export function drawCartouche(ctx: Ctx, x: number, y: number, title: string, sub: string): void {
  ctx.save();
  ctx.font = 'bold 20px Georgia, serif';
  const w = Math.max(ctx.measureText(title).width, 150) + 44;
  const h = 58;
  ctx.fillStyle = 'rgba(236, 222, 176, 0.88)';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 4, w - 8, h - 8, 4);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, x + w / 2, y + 24);
  ctx.font = 'italic 12px Georgia, serif';
  ctx.fillStyle = INK_SOFT;
  ctx.fillText(sub, x + w / 2, y + 43);
  ctx.restore();
}

/** Scale bar of `metres` long at (x, y), `pxPerMetre` px per metre: alternating black and paper blocks. */
export function drawScaleBar(ctx: Ctx, x: number, y: number, metres: number, pxPerMetre: number): void {
  const total = metres * pxPerMetre;
  const parts = 4;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < parts; i++) {
    ctx.fillStyle = i % 2 === 0 ? INK : 'rgba(240, 228, 190, 0.9)';
    ctx.fillRect(x + (total * i) / parts, y, total / parts, 6);
  }
  ctx.strokeRect(x, y, total, 6);
  ctx.fillStyle = INK;
  ctx.font = '11px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('0', x, y + 18);
  ctx.fillText(`${metres >= 1000 ? metres / 1000 : metres} ${metres >= 1000 ? 'km' : 'm'}`, x + total, y + 18);
  ctx.restore();
}

/** A tiny ship under sail (decoration and the player marker): hull and two sails, bow to the right, ~`s` px long. */
export function drawShipGlyph(ctx: Ctx, x: number, y: number, s: number, rotation: number, hull = INK, sail = '#f4ecd2'): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.lineJoin = 'round';
  ctx.fillStyle = sail;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.8, s * 0.05);
  for (const dx of [-0.1, 0.18]) {
    ctx.beginPath();
    ctx.ellipse(dx * s, 0, s * 0.11, s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, -s * 0.09);
  ctx.lineTo(s * 0.4, -s * 0.09);
  ctx.lineTo(s * 0.55, 0);
  ctx.lineTo(s * 0.4, s * 0.09);
  ctx.lineTo(-s * 0.5, s * 0.09);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** A sea serpent for the empty corners: a few humps and a head, in ink. */
export function drawSerpent(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = INK_SOFT;
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.arc(k * s * 0.5, 0, s * 0.2, Math.PI, 0);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-s * 0.2, 0);
  ctx.quadraticCurveTo(-s * 0.25, -s * 0.45, -s * 0.5, -s * 0.38);
  ctx.quadraticCurveTo(-s * 0.62, -s * 0.34, -s * 0.55, -s * 0.28);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-s * 0.5, -s * 0.34, s * 0.02, 0, Math.PI * 2);
  ctx.fill();
  // waves under it
  ctx.beginPath();
  for (let i = -1; i < 7; i++) {
    ctx.moveTo(i * s * 0.28, s * 0.08);
    ctx.quadraticCurveTo(i * s * 0.28 + s * 0.07, s * 0.0, i * s * 0.28 + s * 0.14, s * 0.08);
  }
  ctx.stroke();
  ctx.restore();
}
