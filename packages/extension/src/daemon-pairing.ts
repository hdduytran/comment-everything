import type { KeyValueStore } from './key-value-store.js';

export const DEFAULT_DAEMON_PORT = 4317;
const PAIRING_TTL_MS = 5 * 60_000;

const PAIRING_KEY = 'pairing';
const PENDING_KEY = 'pendingPairing';
const PORT_OVERRIDE_KEY = 'daemonPort';

export interface Pairing {
  token: string;
  port: number;
}

interface PendingPairing {
  port: number;
  expiresAt: number;
}

/** The daemon port to talk to: an explicit override, else the paired port, else the default. */
export async function getDaemonPort(store: KeyValueStore): Promise<number> {
  const override = await store.get<number>(PORT_OVERRIDE_KEY);
  if (isPort(override)) return override;
  return (await loadPairing(store))?.port ?? DEFAULT_DAEMON_PORT;
}

export const daemonBaseUrl = (port: number): string => `http://127.0.0.1:${port}`;

export async function loadPairing(store: KeyValueStore): Promise<Pairing | undefined> {
  const saved = await store.get<Pairing>(PAIRING_KEY);
  return saved && typeof saved.token === 'string' && isPort(saved.port) ? saved : undefined;
}

export async function clearPairing(store: KeyValueStore): Promise<void> {
  await store.remove(PAIRING_KEY);
}

export const pairingUrl = (port: number, extensionId: string): string =>
  `${daemonBaseUrl(port)}/pair?ext=${encodeURIComponent(extensionId)}`;

/**
 * Open a pairing window. Only a token delivered while a window is open (and from the daemon
 * page on the expected port) is accepted, so arbitrary pages cannot push a token at us.
 */
export async function beginPairing(
  store: KeyValueStore,
  extensionId: string,
  now = Date.now(),
): Promise<string> {
  const port = await getDaemonPort(store);
  await store.set(PENDING_KEY, { port, expiresAt: now + PAIRING_TTL_MS } satisfies PendingPairing);
  return pairingUrl(port, extensionId);
}

export interface PairingSender {
  url?: string;
}

/**
 * Handle the `ce-pair` message the daemon's confirmation page sends through
 * `externally_connectable`. Returns true when the token was stored.
 */
export async function acceptPairingMessage(
  store: KeyValueStore,
  message: unknown,
  sender: PairingSender,
  now = Date.now(),
): Promise<boolean> {
  const pending = await store.get<PendingPairing>(PENDING_KEY);
  if (!pending || pending.expiresAt < now) return false;
  const msg = message as { type?: unknown; token?: unknown; port?: unknown } | null;
  if (msg?.type !== 'ce-pair' || typeof msg.token !== 'string' || msg.token.length < 16) {
    return false;
  }
  if (msg.port !== pending.port) return false;
  if (!isDaemonPage(sender.url, pending.port)) return false;
  await store.set(PAIRING_KEY, { token: msg.token, port: pending.port } satisfies Pairing);
  await store.remove(PENDING_KEY);
  return true;
}

function isDaemonPage(url: string | undefined, port: number): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port === String(port);
  } catch {
    return false;
  }
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536;
}
