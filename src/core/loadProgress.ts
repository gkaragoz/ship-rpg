/**
 * Download progress of the big files (GLBs), shared by whoever loads them and whoever shows a loading bar.
 * Each load takes a `trackLoad()` handle; `loadFraction()` is the bytes received over the bytes announced so far,
 * and a file whose size is unknown counts as `UNKNOWN_SIZE` until it is done.
 */
const UNKNOWN_SIZE = 1_000_000;

interface Task {
  loaded: number;
  total: number;
  done: boolean;
}

export interface LoadHandle {
  /** Pass to `GLTFLoader.loadAsync(url, handle.onProgress)`. */
  readonly onProgress: (e: ProgressEvent) => void;
  /** Call when the file has arrived or failed. */
  done(): void;
}

let tasks: Task[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function loadFraction(): number {
  let sum = 0;
  let weight = 0;
  for (const t of tasks) {
    const w = t.total > 0 ? t.total : UNKNOWN_SIZE;
    weight += w;
    sum += t.done ? w : t.total > 0 ? Math.min(t.loaded, t.total) : 0;
  }
  return weight > 0 ? sum / weight : 1;
}

export function isLoading(): boolean {
  return tasks.some((t) => !t.done);
}

export function trackLoad(): LoadHandle {
  const task: Task = { loaded: 0, total: 0, done: false };
  tasks.push(task);
  emit();
  return {
    onProgress: (e) => {
      task.loaded = e.loaded;
      if (e.lengthComputable) task.total = e.total;
      emit();
    },
    done: () => {
      task.done = true;
      if (tasks.every((t) => t.done)) {
        emit(); // listeners see 100 % before the tally starts over
        tasks = [];
      } else emit();
    },
  };
}

/** Called on every change; returns the way to unsubscribe. */
export function subscribeLoad(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Run a load that reports progress (e.g. `(p) => loader.loadAsync(url, p)`) under a tracked handle. */
export async function tracked<T>(load: (onProgress: (e: ProgressEvent) => void) => Promise<T>): Promise<T> {
  const h = trackLoad();
  try {
    return await load(h.onProgress);
  } finally {
    h.done();
  }
}
