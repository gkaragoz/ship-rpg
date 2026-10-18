import type { GameView } from '../core';
import { ISLANDS, PORTS, WORLD_BOUNDS, getNation, terrainHeight, type Island } from '../world';
import './map.css';

export interface MapUi {
  update(view: GameView): void;
  toggle(): void;
  dispose(): void;
}

/** Metres per pixel of the pre-rendered island images. */
const SPRITE_RES = 4;
const MINI_SIZE = 180;
const MINI_RANGE = 900; // metres from the ship to the minimap edge

const LAND_COLORS: [number, [number, number, number]][] = [
  [0, [226, 210, 150]],
  [3, [128, 164, 84]],
  [30, [82, 120, 60]],
  [50, [140, 134, 120]],
];

function landColor(h: number): [number, number, number] {
  for (let i = LAND_COLORS.length - 1; i >= 0; i--) {
    const [at, c] = LAND_COLORS[i] as [number, [number, number, number]];
    if (h >= at) return c;
  }
  return [226, 210, 150];
}

/** Top-down image of one island, with shallows, for the map. */
function buildSprite(island: Island): HTMLCanvasElement {
  const half = island.radius * 1.5;
  const size = Math.ceil((half * 2) / SPRITE_RES);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h = terrainHeight(island.x - half + (i + 0.5) * SPRITE_RES, island.z - half + (j + 0.5) * SPRITE_RES);
      const o = (j * size + i) * 4;
      if (h >= 0) {
        const [r, g, b] = landColor(h);
        img.data.set([r, g, b, 255], o);
      } else if (h > -9) {
        img.data.set([90, 180, 175, Math.round(200 * (1 + h / 9))], o); // shallows fade out
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

/** Minimap (always on) and a full chart (M) showing only what the player has discovered. */
export function createMapUi(host: HTMLElement): MapUi {
  const root = el('div', 'map');
  const mini = el('canvas', 'map-mini');
  mini.width = MINI_SIZE;
  mini.height = MINI_SIZE;
  const chart = el('div', 'map-chart');
  const chartCanvas = el('canvas');
  const hint = el('div', 'map-hint');
  hint.textContent = 'M: haritayı kapat';
  chart.append(chartCanvas, hint);
  chart.hidden = true;
  root.append(mini, chart);
  host.appendChild(root);

  const sprites = new Map<string, HTMLCanvasElement>();
  const sprite = (i: Island): HTMLCanvasElement => {
    let s = sprites.get(i.id);
    if (!s) {
      s = buildSprite(i);
      sprites.set(i.id, s);
    }
    return s;
  };

  /** World (x, z) → canvas pixels, north (-z) up. */
  const draw = (
    canvas: HTMLCanvasElement,
    view: GameView,
    centre: { x: number; z: number },
    metresPerPx: number,
    labels: boolean,
  ): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const sx = (x: number): number => w / 2 + (x - centre.x) / metresPerPx;
    const sy = (z: number): number => h / 2 + (z - centre.z) / metresPerPx;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = labels ? '#d9c79a' : '#2a6f8c';
    ctx.fillRect(0, 0, w, h);

    if (labels) {
      ctx.strokeStyle = 'rgba(80, 55, 20, 0.18)';
      ctx.lineWidth = 1;
      for (let gx = Math.ceil(WORLD_BOUNDS.minX / 500) * 500; gx < WORLD_BOUNDS.maxX; gx += 500) {
        ctx.beginPath();
        ctx.moveTo(sx(gx), 0);
        ctx.lineTo(sx(gx), h);
        ctx.stroke();
      }
      for (let gz = Math.ceil(WORLD_BOUNDS.minZ / 500) * 500; gz < WORLD_BOUNDS.maxZ; gz += 500) {
        ctx.beginPath();
        ctx.moveTo(0, sy(gz));
        ctx.lineTo(w, sy(gz));
        ctx.stroke();
      }
    }

    const seen = new Set(view.discoveredIslands);
    for (const i of ISLANDS) {
      if (!seen.has(i.id)) continue;
      const half = i.radius * 1.5;
      ctx.drawImage(sprite(i), sx(i.x - half), sy(i.z - half), (half * 2) / metresPerPx, (half * 2) / metresPerPx);
    }

    const known = new Set(view.discoveredPorts);
    ctx.font = 'bold 13px Georgia, serif';
    ctx.textAlign = 'center';
    for (const p of PORTS) {
      if (!known.has(p.id)) continue;
      const x = sx(p.anchor.x);
      const y = sy(p.anchor.z);
      ctx.fillStyle = p.id === view.docked ? '#ffffff' : '#c0392b';
      ctx.beginPath();
      ctx.arc(x, y, labels ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (labels) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(245, 235, 205, 0.9)';
        ctx.strokeText(p.name, x, y - 9);
        ctx.fillStyle = '#3b2a12';
        ctx.fillText(p.name, x, y - 9);
      }
    }

    // Enemy ships afloat, as triangles in their flag colour (radar: shown on the minimap, not the chart).
    if (!labels) {
      for (const e of view.enemies) {
        if (e.sinking >= 0) continue;
        ctx.save();
        ctx.translate(sx(e.x), sy(e.z));
        ctx.rotate(-e.heading);
        ctx.fillStyle = `#${getNation(e.nation).flag.toString(16).padStart(6, '0')}`;
        ctx.strokeStyle = '#f3ead2';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(-5, 4);
        ctx.lineTo(-5, -4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // The ship: a triangle pointing along its heading (forward is (cos ψ, -sin ψ) in x, z).
    ctx.save();
    ctx.translate(sx(view.ship.x), sy(view.ship.z));
    ctx.rotate(-view.ship.heading);
    ctx.fillStyle = '#ffe066';
    ctx.strokeStyle = '#3b2a12';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-6, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = labels ? '#3b2a12' : '#f3ead2';
    ctx.font = 'bold 14px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('K', w / 2, 16); // north (Kuzey) is up
  };

  let open = false;
  const resizeChart = (): void => {
    const maxW = Math.min(window.innerWidth - 40, 1100);
    const maxH = window.innerHeight - 90;
    const worldW = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
    const worldH = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ;
    const scale = Math.min(maxW / worldW, maxH / worldH);
    chartCanvas.width = Math.max(240, Math.floor(worldW * scale));
    chartCanvas.height = Math.max(160, Math.floor(worldH * scale));
  };

  return {
    update(view): void {
      // Minimap: circular, centred on the ship.
      draw(mini, view, view.ship, (MINI_RANGE * 2) / MINI_SIZE, false);
      if (open) {
        const worldW = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
        draw(
          chartCanvas,
          view,
          { x: (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2, z: (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2 },
          worldW / chartCanvas.width,
          true,
        );
      }
    },
    toggle(): void {
      open = !open;
      chart.hidden = !open;
      if (open) resizeChart();
    },
    dispose(): void {
      root.remove();
      sprites.clear();
    },
  };
}
