/** Message contract between the injected content script and the service worker. */

export interface RootInfo {
  id: string;
  root: string;
}

export type StatusReply =
  /** Nothing answered on the daemon port. */
  | { state: 'daemon-down'; port: number }
  /** Daemon is up but this browser holds no (valid) token. */
  | { state: 'unpaired'; port: number }
  /** Paired, but the user has not picked a project for this origin yet. */
  | { state: 'needs-root'; origin: string; roots: RootInfo[] }
  | { state: 'ready'; baseUrl: string; root: string | undefined };

export interface ProxiedRequest {
  /** Daemon path + query, e.g. `/comments?source=...`. */
  path: string;
  method: string;
  headers: Record<string, string>;
  /** Base64 request body. */
  body?: string;
}

export type ProxiedResponse =
  { ok: true; status: number; contentType: string; body: string } | { ok: false; error: string };

export type WorkerRequest =
  | { type: 'ce:status' }
  | { type: 'ce:start-pairing' }
  | { type: 'ce:set-root'; root: string }
  | { type: 'ce:capture' }
  | ({ type: 'ce:fetch' } & ProxiedRequest);

export type CaptureReply = { ok: true; dataUrl: string } | { ok: false; error: string };

/** Name of the long-lived port that carries the daemon's SSE stream to a page. */
export const EVENTS_PORT = 'ce-events';

/** Frame forwarded over the events port. */
export interface EventFrame {
  event: string;
  data: string;
}

/** Daemon paths a page may reach through the worker (everything else is refused). */
export const PROXIED_PATH = /^\/(?:comments|roots)(?:[/?]|$)/;
