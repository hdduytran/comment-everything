import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAEMON_PORT,
  acceptPairingMessage,
  beginPairing,
  clearPairing,
  getDaemonPort,
  loadPairing,
} from '../src/daemon-pairing.js';
import { memoryStore } from '../src/key-value-store.js';

const EXT = 'a'.repeat(32);
const TOKEN = 't'.repeat(40);
const daemonPage = (port: number) => ({ url: `http://127.0.0.1:${port}/pair?ext=${EXT}` });
const msg = (port: number, token = TOKEN) => ({ type: 'ce-pair', token, port });

describe('daemon pairing', () => {
  it('builds the pairing url for the default port and remembers nothing yet', async () => {
    const store = memoryStore();
    expect(await getDaemonPort(store)).toBe(DEFAULT_DAEMON_PORT);
    expect(await beginPairing(store, EXT)).toBe(`http://127.0.0.1:4317/pair?ext=${EXT}`);
    expect(await loadPairing(store)).toBeUndefined();
  });

  it('stores the token delivered by the daemon page during an open pairing window', async () => {
    const store = memoryStore();
    await beginPairing(store, EXT);
    expect(await acceptPairingMessage(store, msg(4317), daemonPage(4317))).toBe(true);
    expect(await loadPairing(store)).toEqual({ token: TOKEN, port: 4317 });
  });

  it('refuses a token when no pairing was started', async () => {
    const store = memoryStore();
    expect(await acceptPairingMessage(store, msg(4317), daemonPage(4317))).toBe(false);
    expect(await loadPairing(store)).toBeUndefined();
  });

  it('refuses an expired pairing window', async () => {
    const store = memoryStore();
    await beginPairing(store, EXT, 1_000);
    expect(await acceptPairingMessage(store, msg(4317), daemonPage(4317), 1_000 + 6 * 60_000)).toBe(
      false,
    );
  });

  it('refuses messages from pages that are not the daemon on the expected port', async () => {
    const store = memoryStore();
    await beginPairing(store, EXT);
    for (const url of [
      'https://evil.example/',
      'http://localhost:4317/',
      'http://127.0.0.1:9999/',
      'http://127.0.0.1.evil.example:4317/',
      undefined,
    ]) {
      expect(await acceptPairingMessage(store, msg(4317), { url })).toBe(false);
    }
    expect(await loadPairing(store)).toBeUndefined();
  });

  it('refuses malformed messages and mismatched ports', async () => {
    const store = memoryStore();
    await beginPairing(store, EXT);
    const sender = daemonPage(4317);
    expect(await acceptPairingMessage(store, null, sender)).toBe(false);
    expect(await acceptPairingMessage(store, { type: 'other' }, sender)).toBe(false);
    expect(await acceptPairingMessage(store, msg(4317, 'short'), sender)).toBe(false);
    expect(await acceptPairingMessage(store, msg(5000), sender)).toBe(false);
  });

  it('is one-time: a second delivery after success is refused', async () => {
    const store = memoryStore();
    await beginPairing(store, EXT);
    expect(await acceptPairingMessage(store, msg(4317), daemonPage(4317))).toBe(true);
    expect(await acceptPairingMessage(store, msg(4317, 'x'.repeat(40)), daemonPage(4317))).toBe(
      false,
    );
    expect((await loadPairing(store))?.token).toBe(TOKEN);
  });

  it('honours a port override and can forget the pairing', async () => {
    const store = memoryStore({ daemonPort: 5555 });
    expect(await beginPairing(store, EXT)).toBe(`http://127.0.0.1:5555/pair?ext=${EXT}`);
    expect(await acceptPairingMessage(store, msg(5555), daemonPage(5555))).toBe(true);
    expect(await getDaemonPort(store)).toBe(5555);
    await clearPairing(store);
    expect(await loadPairing(store)).toBeUndefined();
  });
});
