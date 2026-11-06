import type { KeyValueStore } from './key-value-store.js';

/** Storage keys shared with the options page. */
export const SHIELD_PREF_KEY = 'earlyShield';
const ORIGINS_KEY = 'shieldOrigins';

const SCRIPT_ID = 'ce-early-shield';
const SCRIPT_FILE = 'early-event-shield.js';
const ALL_SITES = '<all_urls>';
/** Oldest origins are dropped past this many, so the registered match list stays small. */
const MAX_ORIGINS = 100;

/** The slices of `chrome.scripting` / `chrome.permissions` used here (injectable for tests). */
export interface ShieldApis {
  scripting: Pick<
    typeof chrome.scripting,
    | 'registerContentScripts'
    | 'updateContentScripts'
    | 'unregisterContentScripts'
    | 'getRegisteredContentScripts'
  >;
  permissions: Pick<typeof chrome.permissions, 'contains'>;
}

/** Remember an origin the overlay was opened on; the shield will load early there from now on. */
export async function rememberShieldOrigin(store: KeyValueStore, origin: string): Promise<void> {
  const known = (await store.get<string[]>(ORIGINS_KEY)) ?? [];
  if (known.includes(origin)) return;
  await store.set(ORIGINS_KEY, [...known, origin].slice(-MAX_ORIGINS));
}

/**
 * Make the registered `document_start` script match the user's choices: present only when the
 * user switched the early shield on, granted access to all sites, and has opened the overlay
 * on at least one origin; it then matches exactly those origins. Safe to call at any time.
 */
export async function syncEarlyShield(store: KeyValueStore, apis: ShieldApis): Promise<void> {
  const enabled = (await store.get<boolean>(SHIELD_PREF_KEY)) === true;
  const origins = (await store.get<string[]>(ORIGINS_KEY)) ?? [];
  const allowed = enabled && (await apis.permissions.contains({ origins: [ALL_SITES] }));
  const existing =
    (await apis.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length > 0;

  if (!allowed || origins.length === 0) {
    if (existing) await apis.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }
  const script = {
    id: SCRIPT_ID,
    js: [SCRIPT_FILE],
    matches: origins.map((o) => `${o}/*`),
    runAt: 'document_start' as const,
    allFrames: false,
    persistAcrossSessions: true,
  };
  if (existing) await apis.scripting.updateContentScripts([script]);
  else await apis.scripting.registerContentScripts([script]);
}
