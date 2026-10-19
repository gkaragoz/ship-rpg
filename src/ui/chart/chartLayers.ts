import type { GameView } from '../../core';
import { ISLANDS, PORTS, hash2, portZoneCorners } from '../../world';
import { drawAnchor } from '../anchorIcon';
import { INK } from './parchment';

/** Where the chart is looking: world to canvas, and what has been sailed. */
export interface ChartFrame {
  width: number;
  height: number;
  /** Pixels per metre now (the fit scale times the zoom) and the zoom itself. */
  scale: number;
  zoom: number;
  sx(x: number): number;
  sy(z: number): number;
  trail: readonly { x: number; z: number }[];
}

/** How far the fog is lifted around the ship, the trail and a discovered port (m); islands lift it by 2.1 × their radius. */
const SEEN_SHIP = 420;
const SEEN_TRAIL = 300;
const SEEN_PORT = 360;

/** Draw the fog of war over the chart, lifted where the captain has been or has seen. `fog` is the small canvas it is made on. */
export function drawFog(ctx: CanvasRenderingContext2D, view: GameView, fog: HTMLCanvasElement, fr: ChartFrame): void {
  const f = fog.getContext('2d');
  if (!f) return;
  f.globalCompositeOperation = 'source-over';
  f.clearRect(0, 0, fog.width, fog.height);
  f.fillStyle = 'rgba(112, 92, 58, 0.5)';
  f.fillRect(0, 0, fog.width, fog.height);
  f.globalCompositeOperation = 'destination-out';
  const k = 0.25;
  const clear = (x: number, z: number, metres: number): void => {
    const px = fr.sx(x) * k;
    const py = fr.sy(z) * k;
    const r = Math.max(metres * fr.scale * k, 2);
    const g = f.createRadialGradient(px, py, r * 0.45, px, py, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = g;
    f.fillRect(px - r, py - r, r * 2, r * 2);
  };
  const seen = new Set(view.discoveredIslands);
  for (const i of ISLANDS) if (seen.has(i.id)) clear(i.x, i.z, i.radius * 2.1);
  const known = new Set(view.discoveredPorts);
  for (const p of PORTS) if (known.has(p.id)) clear(p.anchor.x, p.anchor.z, SEEN_PORT);
  for (const t of fr.trail) clear(t.x, t.z, SEEN_TRAIL);
  clear(view.ship.x, view.ship.z, SEEN_SHIP);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fog, 0, 0, fr.width, fr.height);
  }

function house(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    ctx.fillStyle = '#f0e4c2';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.8;
    ctx.fillRect(x - s, y - s * 0.4, s * 2, s * 1.2);
    ctx.strokeRect(x - s, y - s * 0.4, s * 2, s * 1.2);
    ctx.fillStyle = '#b5482c';
    ctx.beginPath();
    ctx.moveTo(x - s * 1.25, y - s * 0.4);
    ctx.lineTo(x, y - s * 1.5);
    ctx.lineTo(x + s * 1.25, y - s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

type Box = { x0: number; y0: number; x1: number; y1: number };

/** The discovered ports: houses and the entry zone when zoomed in, the anchor, and a name that finds a free spot beside it. */
export function drawPorts(ctx: CanvasRenderingContext2D, view: GameView, fr: ChartFrame): void {
    const known = new Set(view.discoveredPorts);
    const placed: Box[] = [];
    const free = (r: Box): boolean => !placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0);
    ctx.font = `italic bold ${Math.round(12 + Math.min(fr.zoom, 3) * 1.5)}px Georgia, serif`;
    ctx.textBaseline = 'middle';
    for (const p of PORTS) {
      if (!known.has(p.id)) continue;
      const x = fr.sx(p.anchor.x);
      const y = fr.sy(p.anchor.z);
      const inZone = view.nearestPort?.id === p.id && view.nearestPort.inZone;
      if (fr.zoom >= 1.8) {
        for (let h = 0; h < 5; h++) house(ctx, fr.sx(p.town.x) + (hash2(h, 1, p.name.length) - 0.5) * 34, fr.sy(p.town.z) + (hash2(h, 2, p.name.length) - 0.5) * 24, 3 + fr.zoom * 0.5);
      }
      if (fr.zoom >= 2.2) {
        ctx.strokeStyle = 'rgba(214, 150, 20, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        portZoneCorners(p).forEach((q, n) => (n === 0 ? ctx.moveTo(fr.sx(q.x), fr.sy(q.z)) : ctx.lineTo(fr.sx(q.x), fr.sy(q.z))));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      drawAnchor(ctx, x, y, 17 + (inZone ? 4 : 0), p.id === view.docked ? '#ffffff' : inZone ? '#ffd34d' : '#a52a1c');
      const w = ctx.measureText(p.name).width;
      // the label goes above, below, right of or left of the anchor, whichever is free
      const spots: [number, number][] = [[x - w / 2, y - 18], [x - w / 2, y + 18], [x + 12, y], [x - 12 - w, y]];
      const spot = spots.find(([lx, ly]) => free({ x0: lx, y0: ly - 8, x1: lx + w, y1: ly + 8 })) ?? (spots[0] as [number, number]);
      placed.push({ x0: spot[0], y0: spot[1] - 8, x1: spot[0] + w, y1: spot[1] + 8 });
      ctx.textAlign = 'left';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(238, 226, 186, 0.92)';
      ctx.strokeText(p.name, spot[0], spot[1]);
      ctx.fillStyle = INK;
      ctx.fillText(p.name, spot[0], spot[1]);
    }
}

