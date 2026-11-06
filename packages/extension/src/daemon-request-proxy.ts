import { base64ToBytes, bytesToBase64 } from './base64-bytes.js';
import { daemonBaseUrl, getDaemonPort, loadPairing } from './daemon-pairing.js';
import {
  PROXIED_PATH,
  type EventFrame,
  type ProxiedRequest,
  type ProxiedResponse,
} from './extension-messages.js';
import type { KeyValueStore } from './key-value-store.js';
import { SseFrameParser } from './sse-frame-parser.js';

const TOKEN_HEADER = 'x-ce-token';
const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

/** True when anything answers HTTP on the daemon port (a refusal or error status still counts). */
export async function probeDaemon(
  port: number,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  try {
    await fetch(`${daemonBaseUrl(port)}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Perform a daemon call on behalf of a page. Running here keeps the request out of the page's
 * CSP and CORS, and keeps the token out of page-reachable code: it is attached only in this worker.
 */
export async function proxyDaemonFetch(
  store: KeyValueStore,
  req: ProxiedRequest,
): Promise<ProxiedResponse> {
  if (!PROXIED_PATH.test(req.path)) return { ok: false, error: 'Path not allowed' };
  const pairing = await loadPairing(store);
  if (!pairing) return { ok: false, error: 'Not paired with the daemon' };
  try {
    const headers = new Headers(req.headers);
    headers.set(TOKEN_HEADER, pairing.token);
    const res = await fetch(daemonBaseUrl(pairing.port) + req.path, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : base64ToBytes(req.body),
    });
    return {
      ok: true,
      status: res.status,
      contentType: res.headers.get('content-type') ?? 'application/json',
      body: bytesToBase64(new Uint8Array(await res.arrayBuffer())),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Follow the daemon's `/events` stream until `signal` aborts or the stream ends, handing each
 * frame to `onFrame`. Resolves when the stream closes; rejects on connection errors.
 */
export async function streamDaemonEvents(
  store: KeyValueStore,
  onFrame: (frame: EventFrame) => void,
  signal: AbortSignal,
): Promise<void> {
  const pairing = await loadPairing(store);
  if (!pairing) throw new Error('Not paired with the daemon');
  const res = await fetch(`${daemonBaseUrl(await getDaemonPort(store))}/events`, {
    headers: { [TOKEN_HEADER]: pairing.token, accept: 'text/event-stream' },
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Event stream refused (${res.status})`);
  const parser = new SseFrameParser();
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    for (const frame of parser.push(value)) onFrame(frame);
  }
}
