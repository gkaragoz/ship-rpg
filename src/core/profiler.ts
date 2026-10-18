/** Frame-time statistics for the debug overlay: a ring of recent frame times and per-section CPU timers. */
export interface ProfilerStats {
  /** Frames per second over the history, and over its slowest 1 % of frames. */
  fps: number;
  lowFps: number;
  /** Mean, 95th percentile and worst frame time (ms) over the history. */
  avgMs: number;
  p95Ms: number;
  worstMs: number;
  /** Mean CPU time (ms) each named section took per frame, over the frames since the last `stats()`. */
  sections: Readonly<Record<string, number>>;
  /** Frames in the history. */
  frames: number;
}

export interface Profiler {
  /** Call once per drawn frame with the current time (ms): the time since the previous call is the frame time. */
  frame(now: number): void;
  /** Time a named part of the frame; the same name may be timed several times a frame (it adds up). */
  begin(section: string): void;
  end(section: string): void;
  stats(): ProfilerStats;
  /** The most recent frame times (ms), oldest first, for the graph (at most the history size). */
  recent(): Float32Array;
  reset(): void;
}

/** Frame times over this many frames are kept (about two seconds at 60 fps, as in the reference project's panel). */
export const HISTORY = 120;

/** Frames longer than this (ms) are a stall (a hidden tab, a long load), not a measurement. */
const STALL_MS = 1000;

/** `now` is injectable for tests. */
export function createProfiler(now: () => number = () => performance.now(), size = HISTORY): Profiler {
  const frames = new Float32Array(size);
  let index = 0;
  let filled = 0;
  let last = -1;
  const open = new Map<string, number>();
  let totals = new Map<string, number>();
  let counted = 0;

  const reset = (): void => {
    index = 0;
    filled = 0;
    last = -1;
    open.clear();
    totals = new Map();
    counted = 0;
  };

  return {
    frame(time): void {
      if (last >= 0) {
        const dt = time - last;
        if (dt > 0 && dt < STALL_MS) {
          frames[index] = dt;
          index = (index + 1) % size;
          filled = Math.min(size, filled + 1);
          counted++;
        }
      }
      last = time;
    },
    begin(section): void {
      open.set(section, now());
    },
    end(section): void {
      const start = open.get(section);
      if (start === undefined) return;
      open.delete(section);
      totals.set(section, (totals.get(section) ?? 0) + (now() - start));
    },
    stats(): ProfilerStats {
      const times = Array.from(frames.subarray(0, filled)).sort((a, b) => a - b);
      const n = times.length;
      let sum = 0;
      for (const t of times) sum += t;
      const avgMs = n ? sum / n : 0;
      const slowest = Math.max(1, Math.ceil(n * 0.01));
      let slowSum = 0;
      for (let i = n - slowest; i < n; i++) slowSum += times[i] ?? 0;
      const lowMs = n ? slowSum / slowest : 0;
      const sections: Record<string, number> = {};
      for (const [name, total] of totals) sections[name] = counted > 0 ? total / counted : 0;
      totals = new Map();
      counted = 0;
      return {
        fps: avgMs > 0 ? 1000 / avgMs : 0,
        lowFps: lowMs > 0 ? 1000 / lowMs : 0,
        avgMs,
        p95Ms: n ? (times[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0) : 0,
        worstMs: n ? (times[n - 1] ?? 0) : 0,
        sections,
        frames: n,
      };
    },
    recent(): Float32Array {
      const out = new Float32Array(filled);
      for (let i = 0; i < filled; i++) out[i] = frames[(index - filled + i + size * 2) % size] ?? 0;
      return out;
    },
    reset,
  };
}

/** Colour of a frame time on the graph: green up to ~57 fps, amber to 40, red beyond (the reference project's thresholds). */
export const frameColor = (ms: number): string => (ms > 25 ? '#e0463b' : ms > 17.5 ? '#e6b73a' : '#4cc35b');
