import { DEFAULTS, defaults, merge, sanitize, withPreset, type DeepPartial, type Settings } from './schema';

const KEY = 'ship-rpg.settings';
/** Water quality saved by the old `K` key, read once when there are no settings yet. */
const LEGACY_QUALITY_KEY = 'ship-rpg.quality';

/** The bit of `Storage` the store needs (injectable for tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SettingsStore {
  get(): Readonly<Settings>;
  /** Change some values; saved unless `persist` is false (used for automatic quality drops). */
  patch(change: DeepPartial<Settings>, persist?: boolean): void;
  preset(name: 'low' | 'medium' | 'high'): void;
  reset(): void;
  subscribe(listener: (settings: Readonly<Settings>, change: DeepPartial<Settings>) => void): () => void;
}

/** URL overrides: `?quality=` (water), `?aa=` and `?debug`. They apply to this page load only and are never saved. */
export function urlOverrides(search: string): DeepPartial<Settings> {
  const q = new URLSearchParams(search);
  const out: DeepPartial<Settings> = {};
  const quality = q.get('quality');
  if (quality === 'low' || quality === 'medium' || quality === 'high') out.graphics = { water: quality };
  const aa = q.get('aa');
  if (aa === 'off' || aa === 'fxaa' || aa === 'msaa2' || aa === 'msaa4' || aa === 'msaa8') out.graphics = { ...out.graphics, antialias: aa };
  if (q.has('debug')) out.debug = { overlay: true };
  return out;
}

export function createSettingsStore(storage: StorageLike | null, search = ''): SettingsStore {
  let saved = defaults();
  try {
    const raw = storage?.getItem(KEY);
    if (raw) {
      saved = sanitize(JSON.parse(raw));
    } else {
      const legacy = storage?.getItem(LEGACY_QUALITY_KEY);
      if (legacy === 'low' || legacy === 'medium' || legacy === 'high') saved = merge(saved, { graphics: { water: legacy } });
    }
  } catch {
    saved = defaults(); // blocked storage or a damaged value: start from the defaults
  }
  // `saved` is the user's choice; URL overrides sit on top of it for this page load only.
  let current = merge(saved, urlOverrides(search));
  const listeners = new Set<(s: Readonly<Settings>, c: DeepPartial<Settings>) => void>();
  const save = (): void => {
    try {
      storage?.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* the choice just does not persist */
    }
  };
  const apply = (next: Settings, change: DeepPartial<Settings>, persist: boolean): void => {
    current = next;
    if (persist) {
      saved = merge(saved, change);
      save();
    }
    for (const l of [...listeners]) l(current, change);
  };
  return {
    get: () => current,
    patch(change, persist = true): void {
      apply(merge(current, change), change, persist);
    },
    preset(name): void {
      const next = withPreset(current, name);
      apply(next, { graphics: next.graphics }, true);
    },
    reset(): void {
      saved = defaults();
      current = defaults();
      save();
      for (const l of [...listeners]) l(current, DEFAULTS);
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let shared: SettingsStore | null = null;

/** The game's one settings store, on the browser's `localStorage` and URL. */
export function getSettings(): SettingsStore {
  if (!shared) {
    let storage: StorageLike | null = null;
    try {
      storage = typeof window === 'undefined' ? null : window.localStorage;
    } catch {
      storage = null;
    }
    shared = createSettingsStore(storage, typeof window === 'undefined' ? '' : window.location.search);
  }
  return shared;
}
