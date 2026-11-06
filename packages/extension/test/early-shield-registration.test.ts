import { describe, expect, it, vi } from 'vitest';
import {
  SHIELD_PREF_KEY,
  rememberShieldOrigin,
  syncEarlyShield,
  type ShieldApis,
} from '../src/early-shield-registration.js';
import { memoryStore } from '../src/key-value-store.js';

function apis(granted: boolean) {
  const registered: { matches: string[] }[] = [];
  const api = {
    scripting: {
      getRegisteredContentScripts: vi.fn(async () => registered.slice()),
      registerContentScripts: vi.fn(
        async (s: { matches: string[] }[]) => void registered.push(...s),
      ),
      updateContentScripts: vi.fn(
        async (s: { matches: string[] }[]) => void registered.splice(0, 1, ...s),
      ),
      unregisterContentScripts: vi.fn(async () => void registered.splice(0)),
    },
    permissions: { contains: vi.fn(async () => granted) },
  };
  return { api: api as unknown as ShieldApis, registered, raw: api };
}

describe('early shield registration', () => {
  it('registers nothing by default (no new permission is needed)', async () => {
    const { api, raw } = apis(false);
    const store = memoryStore();
    await rememberShieldOrigin(store, 'https://github.com');
    await syncEarlyShield(store, api);
    expect(raw.scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it('needs both the user setting and the all-sites permission', async () => {
    const store = memoryStore({ [SHIELD_PREF_KEY]: true });
    await rememberShieldOrigin(store, 'https://github.com');
    const denied = apis(false);
    await syncEarlyShield(store, denied.api);
    expect(denied.raw.scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it('matches exactly the origins where the panel was opened, at document_start', async () => {
    const { api, raw, registered } = apis(true);
    const store = memoryStore({ [SHIELD_PREF_KEY]: true });
    await rememberShieldOrigin(store, 'https://github.com');
    await rememberShieldOrigin(store, 'http://localhost:3000');
    await rememberShieldOrigin(store, 'https://github.com'); // duplicate
    await syncEarlyShield(store, api);
    expect(raw.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({
        js: ['early-event-shield.js'],
        runAt: 'document_start',
        allFrames: false,
        persistAcrossSessions: true,
        matches: ['https://github.com/*', 'http://localhost:3000/*'],
      }),
    ]);

    await rememberShieldOrigin(store, 'https://example.com');
    await syncEarlyShield(store, api);
    expect(raw.scripting.updateContentScripts).toHaveBeenCalledOnce();
    expect(registered[0]!.matches).toHaveLength(3);
  });

  it('unregisters when the user turns it off or revokes access', async () => {
    const { api, raw, registered } = apis(true);
    const store = memoryStore({ [SHIELD_PREF_KEY]: true });
    await rememberShieldOrigin(store, 'https://github.com');
    await syncEarlyShield(store, api);
    expect(registered).toHaveLength(1);
    await store.set(SHIELD_PREF_KEY, false);
    await syncEarlyShield(store, api);
    expect(raw.scripting.unregisterContentScripts).toHaveBeenCalledOnce();
    expect(registered).toHaveLength(0);
  });
});
