import type { KeyValueStore } from './key-value-store.js';

/**
 * How the extension decides where comments go:
 * - `auto`: use the daemon when it answers and this browser is paired, else stay standalone.
 * - `standalone`: never contact a daemon; comments stay in this browser.
 * - `daemon`: always use the daemon (setup cards guide pairing and project choice).
 */
export type ModePreference = 'auto' | 'standalone' | 'daemon';

export const MODE_PREFERENCES: readonly ModePreference[] = ['auto', 'standalone', 'daemon'];
export const DEFAULT_MODE: ModePreference = 'auto';
const MODE_KEY = 'modePreference';

/** Time the toggle waits for the daemon's /health before falling back to standalone (auto). */
export const AUTO_PROBE_TIMEOUT_MS = 800;
/** Time allowed when the user forced daemon mode: a slow answer is still an answer. */
export const FORCED_PROBE_TIMEOUT_MS = 2_000;

export function isModePreference(value: unknown): value is ModePreference {
  return MODE_PREFERENCES.includes(value as ModePreference);
}

export async function getModePreference(store: KeyValueStore): Promise<ModePreference> {
  const saved = await store.get<unknown>(MODE_KEY);
  return isModePreference(saved) ? saved : DEFAULT_MODE;
}

export async function setModePreference(store: KeyValueStore, mode: ModePreference): Promise<void> {
  if (!isModePreference(mode)) throw new Error(`Unknown mode: ${String(mode)}`);
  await store.set(MODE_KEY, mode);
}
