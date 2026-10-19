import type { GameView } from '../../core';
import { ISLANDS, WORLD_BOUNDS, type Island } from '../../world';
import { buildLandArt, type LandArt } from './landart';
import { drawFog, drawPorts, type ChartFrame } from './chartLayers';
import { drawCartouche, drawCompassRose, drawFrame, drawRhumbLines, drawScaleBar, drawSerpent, drawShipGlyph } from './ornaments';
import { INK, INK_SOFT, createParchment } from './parchment';

const MARGIN = 34;
const MAX_ZOOM = 6;
/** Metres between grid lines (and the cell of the letter/number grid). */
const GRID = 500;
const WORLD_W = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
const WORLD_H = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ;
/** A trail point is kept every this many metres, up to `TRAIL_MAX` of them. */
const TRAIL_STEP = 50;
const TRAIL_MAX = 800;
export interface Chart {
  readonly root: HTMLElement;
  isOpen(): boolean;
  toggle(): void;
  update(view: GameView): void;
  dispose(): void;
}

const button = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
};

/** The full chart (`M`): parchment, hand-tinted islands, fog of war, grid, rose, route, zoom and pan. */
export function createChart(host: HTMLElement): Chart {
  const root = document.createElement('div');
  root.className = 'chart';
  root.hidden = true;
  const canvas = document.createElement('canvas');
  const tools = document.createElement('div');
  tools.className = 'chart-tools';
  root.append(canvas, tools);
  host.appendChild(root);

  const art = new Map<string, LandArt>();
  const landArt = (i: Island): LandArt => {
    let a = art.get(i.id);
    if (!a) {
      a = buildLandArt(i);
      art.set(i.id, a);
    }
    return a;
  };
  const fog = document.createElement('canvas');
  let paper: HTMLCanvasElement | null = null;
  let open = false;
  let zoom = 1;
  const centre = { x: (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2, z: (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2 };
  const trail: { x: number; z: number }[] = [];
  let last: GameView | null = null;

  const base = (): number => Math.min((canvas.width - MARGIN * 2) / WORLD_W, (canvas.height - MARGIN * 2) / WORLD_H);
  const scale = (): number => base() * zoom;
  const sx = (x: number): number => canvas.width / 2 + (x - centre.x) * scale();
  const sy = (z: number): number => canvas.height / 2 + (z - centre.z) * scale();

  const frame = (): ChartFrame => ({ width: canvas.width, height: canvas.height, scale: scale(), zoom, sx, sy, trail });

  const clampCentre = (): void => {
    centre.x = Math.min(Math.max(centre.x, WORLD_BOUNDS.minX), WORLD_BOUNDS.maxX);
    centre.z = Math.min(Math.max(centre.z, WORLD_BOUNDS.minZ), WORLD_BOUNDS.maxZ);
  };
  const resize = (): void => {
    canvas.width = Math.max(320, Math.min(window.innerWidth - 24, 1400));
    canvas.height = Math.max(240, window.innerHeight - 70);
    paper = createParchment(canvas.width, canvas.height);
    fog.width = Math.ceil(canvas.width / 4);
    fog.height = Math.ceil(canvas.height / 4);
  };
  const zoomBy = (factor: number, px = canvas.width / 2, py = canvas.height / 2): void => {
    const wx = centre.x + (px - canvas.width / 2) / scale();
    const wz = centre.z + (py - canvas.height / 2) / scale();
    zoom = Math.min(Math.max(zoom * factor, 1), MAX_ZOOM);
    centre.x = wx - (px - canvas.width / 2) / scale();
    centre.z = wz - (py - canvas.height / 2) / scale();
    clampCentre();
  };
  const reset = (): void => {
    zoom = 1;
    centre.x = (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2;
    centre.z = (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2;
  };
  function toggle(): void {
    open = !open;
    root.hidden = !open;
    if (open) {
      resize();
      reset();
    }
  }
  tools.append(
    button('+', 'Yakınlaştır', () => zoomBy(1.5)),
    button('−', 'Uzaklaştır', () => zoomBy(1 / 1.5)),
    button('◎', 'Gemiye git', () => {
      if (!last) return;
      zoom = Math.max(zoom, 2.5);
      centre.x = last.ship.x;
      centre.z = last.ship.z;
      clampCentre();
    }),
    button('⟲', 'Tümünü göster', reset),
    button('✕', 'Haritayı kapat (M)', toggle),
  );

  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, ((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height);
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    const k = canvas.width / r.width;
    centre.x -= ((e.clientX - drag.x) * k) / scale();
    centre.z -= ((e.clientY - drag.y) * k) / scale();
    drag = { x: e.clientX, y: e.clientY };
    clampCentre();
  });
  const endDrag = (): void => {
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  const onResize = (): void => {
    if (open) resize();
  };
  window.addEventListener('resize', onResize);

  const drawWind = (ctx: CanvasRenderingContext2D, view: GameView): void => {
    const wx = MARGIN + 220;
    const wy = canvas.height - MARGIN - 28;
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(-(view.wind.from + Math.PI));
    ctx.strokeStyle = '#2a5f7a';
    ctx.fillStyle = '#2a5f7a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(7, -5);
    ctx.lineTo(7, 5);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = INK;
    ctx.font = '12px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Rüzgâr ${view.wind.speed.toFixed(1)} m/s`, wx + 24, wy + 1);
  };

  const draw = (view: GameView): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!paper) resize();
    if (paper) ctx.drawImage(paper, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN, MARGIN, canvas.width - MARGIN * 2, canvas.height - MARGIN * 2);
    ctx.clip();

    const roseA = { x: WORLD_BOUNDS.maxX - 330, z: WORLD_BOUNDS.maxZ - 300 };
    const roseB = { x: WORLD_BOUNDS.maxX - 300, z: WORLD_BOUNDS.minZ + 260 };
    drawRhumbLines(ctx, sx(roseA.x), sy(roseA.z), canvas.width * 2);
    drawRhumbLines(ctx, sx(roseB.x), sy(roseB.z), canvas.width * 2);
    ctx.strokeStyle = 'rgba(58, 42, 18, 0.2)';
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(WORLD_BOUNDS.minX / GRID) * GRID; gx < WORLD_BOUNDS.maxX; gx += GRID) {
      ctx.beginPath();
      ctx.moveTo(sx(gx), 0);
      ctx.lineTo(sx(gx), canvas.height);
      ctx.stroke();
    }
    for (let gz = Math.ceil(WORLD_BOUNDS.minZ / GRID) * GRID; gz < WORLD_BOUNDS.maxZ; gz += GRID) {
      ctx.beginPath();
      ctx.moveTo(0, sy(gz));
      ctx.lineTo(canvas.width, sy(gz));
      ctx.stroke();
    }
    drawSerpent(ctx, sx(WORLD_BOUNDS.minX + 600), sy(WORLD_BOUNDS.maxZ - 160), 360 * scale());

    const seen = new Set(view.discoveredIslands);
    for (const i of ISLANDS) {
      if (!seen.has(i.id)) continue;
      const a = landArt(i);
      ctx.drawImage(a.canvas, sx(i.x - a.half), sy(i.z - a.half), a.half * 2 * scale(), a.half * 2 * scale());
    }
    drawFog(ctx, view, fog, frame());
    for (const i of ISLANDS) {
      if (!seen.has(i.id)) continue;
      ctx.font = `italic ${Math.round(11 + zoom * 2)}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = INK_SOFT;
      ctx.fillText(i.name.toUpperCase().split('').join(' '), sx(i.x), sy(i.z) + i.radius * 1.15 * scale());
    }
    drawPorts(ctx, view, frame());

    if (trail.length > 1) {
      ctx.strokeStyle = 'rgba(165, 42, 28, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      trail.forEach((t, n) => (n === 0 ? ctx.moveTo(sx(t.x), sy(t.z)) : ctx.lineTo(sx(t.x), sy(t.z))));
      ctx.lineTo(sx(view.ship.x), sy(view.ship.z));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawShipGlyph(ctx, sx(view.ship.x), sy(view.ship.z), 26, -view.ship.heading, '#a52a1c');
    const roseScale = Math.max(0.6, zoom * base() * 1.3);
    drawCompassRose(ctx, sx(roseA.x), sy(roseA.z), 58 * roseScale);
    drawCompassRose(ctx, sx(roseB.x), sy(roseB.z), 34 * roseScale);
    ctx.restore();

    drawFrame(ctx, canvas.width, canvas.height, MARGIN, {
      x: sx(Math.floor(WORLD_BOUNDS.minX / GRID) * GRID),
      y: sy(Math.floor(WORLD_BOUNDS.minZ / GRID) * GRID),
      px: GRID * scale(),
      py: GRID * scale(),
    });
    drawCartouche(ctx, MARGIN + 14, MARGIN + 14, 'KARAYİP ADALARI', 'Deniz haritası · kuzey yukarıda');
    drawScaleBar(ctx, MARGIN + 20, canvas.height - MARGIN - 38, 500, scale());
    drawWind(ctx, view);
  };

  return {
    root,
    isOpen: () => open,
    toggle,
    update(view): void {
      last = view;
      const p = trail[trail.length - 1];
      if (!p || Math.hypot(p.x - view.ship.x, p.z - view.ship.z) > TRAIL_STEP) {
        trail.push({ x: view.ship.x, z: view.ship.z });
        if (trail.length > TRAIL_MAX) trail.shift();
      }
      if (open) draw(view);
    },
    dispose(): void {
      window.removeEventListener('resize', onResize);
      root.remove();
      art.clear();
    },
  };
}
