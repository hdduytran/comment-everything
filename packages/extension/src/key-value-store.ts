/** Minimal async key-value contract so pairing/mapping logic is testable without `chrome.*`. */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** Every stored key (used to find all locally saved comments). */
  keys(): Promise<string[]>;
}

/** `chrome.storage.local` backed store (survives browser restarts, never synced). */
export function chromeLocalStore(): KeyValueStore {
  const area = chrome.storage.local;
  return {
    async get<T>(key: string) {
      return (await area.get(key))[key] as T | undefined;
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
    async keys() {
      return Object.keys(await area.get(null));
    },
  };
}

/** In-memory store for unit tests. */
export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
    keys: async () => [...data.keys()],
  };
}
