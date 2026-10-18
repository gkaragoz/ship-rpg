import { HISTORY, frameColor, type Profiler } from '../core';
import './debugOverlay.css';

export interface DebugOverlay {
  readonly visible: boolean;
  readonly detail: 'mini' | 'full';
  setVisible(on: boolean): void;
  setDetail(detail: 'mini' | 'full'): void;
  /** Redraw (at most every 250 ms): `extra` supplies the lines the current screen adds (draw calls, counters …). */
  update(now: number, profiler: Profiler, extra: () => readonly string[]): void;
  dispose(): void;
}

const REFRESH_MS = 250;
const GRAPH = { width: 200, height: 36, fullScaleMs: 33.3 };

const ms = (v: number): string => `${v.toFixed(2)} ms`;

/** The lines of the profiler panel for a set of stats (separate from the DOM so it can be tested). */
export function profilerLines(stats: ReturnType<Profiler['stats']>, detail: 'mini' | 'full', heapMb: number | null): string[] {
  const lines = [`FPS        ${stats.fps.toFixed(0)}  (%1 düşük ${stats.lowFps.toFixed(0)})`, `Kare       ${ms(stats.avgMs)}`];
  if (detail === 'mini') return lines;
  lines.push(`           p95 ${stats.p95Ms.toFixed(1)}  en kötü ${stats.worstMs.toFixed(1)} ms`);
  for (const [name, value] of Object.entries(stats.sections).sort((a, b) => b[1] - a[1])) lines.push(`${name.padEnd(11)}${ms(value)}`);
  if (heapMb !== null) lines.push(`JS heap    ${heapMb.toFixed(1)} MB`);
  return lines;
}

/** A frame profiler panel (FPS, 1 % low, frame and section times, a colour-coded frame-time graph), toggled on and off. */
export function createDebugOverlay(host: HTMLElement): DebugOverlay {
  const root = document.createElement('div');
  root.className = 'debug-overlay';
  root.hidden = true;
  const text = document.createElement('pre');
  const graph = document.createElement('canvas');
  graph.width = GRAPH.width;
  graph.height = GRAPH.height;
  root.append(text, graph);
  host.append(root);
  const ctx = graph.getContext('2d');
  let visible = false;
  let detail: 'mini' | 'full' = 'full';
  let last = -Infinity;

  const drawGraph = (frames: Float32Array): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, graph.width, graph.height);
    const scale = graph.height / GRAPH.fullScaleMs;
    const bar = graph.width / HISTORY;
    frames.forEach((value, i) => {
      const h = Math.min(graph.height, value * scale);
      ctx.fillStyle = frameColor(value);
      ctx.fillRect(i * bar, graph.height - h, bar - 0.5, h);
    });
  };

  return {
    get visible(): boolean {
      return visible;
    },
    get detail(): 'mini' | 'full' {
      return detail;
    },
    setVisible(on): void {
      visible = on;
      root.hidden = !on;
      last = -Infinity;
    },
    setDetail(next): void {
      detail = next;
      last = -Infinity;
    },
    update(now, profiler, extra): void {
      if (!visible || now - last < REFRESH_MS) return;
      last = now;
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      const lines = profilerLines(profiler.stats(), detail, heap ? heap.usedJSHeapSize / 1048576 : null);
      if (detail === 'full') lines.push(...extra());
      text.textContent = lines.join('\n');
      drawGraph(profiler.recent());
    },
    dispose(): void {
      root.remove();
    },
  };
}
