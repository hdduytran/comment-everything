import { base64ToBytes, bytesToBase64 } from './base64-bytes.js';
import {
  EVENTS_PORT,
  type EventFrame,
  type ProxiedResponse,
  type WorkerRequest,
} from './extension-messages.js';

/** Send a request to the service worker and unwrap its reply. */
export function askWorker<T>(request: WorkerRequest): Promise<T> {
  return chrome.runtime.sendMessage(request) as Promise<T>;
}

/**
 * `fetch` replacement for the overlay's HTTP transport: the real request runs in the service
 * worker (page CSP cannot block it, the token never reaches page-reachable code).
 */
export const proxyFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
  const body = init?.body;
  if (body !== undefined && body !== null && !(body instanceof Blob) && typeof body !== 'string') {
    throw new TypeError('Unsupported request body for the daemon proxy');
  }
  const bytes =
    body instanceof Blob
      ? new Uint8Array(await body.arrayBuffer())
      : typeof body === 'string'
        ? new TextEncoder().encode(body)
        : undefined;

  const reply = await askWorker<ProxiedResponse>({
    type: 'ce:fetch',
    path: url.pathname + url.search,
    method: init?.method ?? 'GET',
    headers,
    body: bytes && bytesToBase64(bytes),
  });
  if (!reply.ok) throw new Error(reply.error);
  return new Response(base64ToBytes(reply.body), {
    status: reply.status,
    headers: { 'content-type': reply.contentType },
  });
};

type Listener = (ev: MessageEvent<string>) => void;

/**
 * Just enough of `EventSource` for the overlay transport, fed by a port to the service worker.
 * If the worker stops (idle shutdown, daemon restart) the port closes and this reconnects.
 */
export class ProxyEventSource {
  private readonly listeners = new Map<string, Set<Listener>>();
  private port: chrome.runtime.Port | null = null;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | undefined;

  // The overlay passes the daemon URL; the worker already knows where the daemon is.
  constructor(_url?: string) {
    this.connect();
  }

  addEventListener(name: string, listener: Listener): void {
    const set = this.listeners.get(name) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(name, set);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retry);
    this.port?.disconnect();
    this.port = null;
  }

  private connect(): void {
    const port = chrome.runtime.connect({ name: EVENTS_PORT });
    this.port = port;
    port.onMessage.addListener((frame: EventFrame) => {
      const event = new MessageEvent('message', { data: frame.data });
      this.listeners.get(frame.event)?.forEach((l) => l(event));
    });
    port.onDisconnect.addListener(() => {
      this.port = null;
      if (!this.closed) this.retry = setTimeout(() => this.connect(), 2_000);
    });
  }
}
