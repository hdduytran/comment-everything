import type { Comment, CommentInput } from '@comment-everything/core/browser';
import type { AgentsStatus, DaemonEvent, DaemonTransport } from './host-adapter.js';

export interface HttpTransportOptions {
  /** Daemon origin, e.g. `http://127.0.0.1:4317`. */
  baseUrl: string;
  token: string;
  /** Relative file path or http(s) URL the comments belong to. */
  source: string;
  /** Absolute project root (file sources only). */
  root?: string;
  fetchImpl?: typeof fetch;
  eventSourceImpl?: typeof EventSource;
}

const EVENT_NAMES = [
  'ready',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'batch.sent',
  'file.changed',
  'agents.changed',
] as const;

/** `DaemonTransport` over the daemon's REST API and `/events` stream, authenticated by token. */
export function createHttpDaemonTransport(opts: HttpTransportOptions): DaemonTransport {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const ES = opts.eventSourceImpl ?? globalThis.EventSource;

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('x-ce-token', opts.token);
    const res = await doFetch(opts.baseUrl + path, { ...init, headers });
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (!res.ok) throw new Error(data.message ?? data.error ?? `Daemon responded ${res.status}`);
    return data as T;
  }
  const scope = () =>
    new URLSearchParams(opts.root ? { root: opts.root } : { source: opts.source }).toString();

  const handlers = new Set<(e: DaemonEvent) => void>();
  let stream: EventSource | null = null;
  const openStream = () => {
    const es = new ES(`${opts.baseUrl}/events?token=${encodeURIComponent(opts.token)}`);
    for (const name of EVENT_NAMES) {
      es.addEventListener(name, (ev) => {
        let data: object = {};
        try {
          data = JSON.parse((ev as MessageEvent<string>).data) as object;
        } catch {
          return; // ignore malformed frames
        }
        handlers.forEach((h) => h({ ...data, type: name } as DaemonEvent));
      });
    }
    return es;
  };

  return {
    async sendBatch(comments: CommentInput[]) {
      return call('/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: opts.root, comments }),
      });
    },
    async uploadAsset(image: Blob) {
      const res = await call<{ asset: string }>(`/comments/assets?${scope()}`, {
        method: 'POST',
        headers: { 'content-type': image.type || 'image/png' },
        body: image,
      });
      return res.asset;
    },
    async listComments(): Promise<Comment[]> {
      const q = new URLSearchParams({ source: opts.source });
      if (opts.root) q.set('root', opts.root);
      return (await call<{ comments: Comment[] }>(`/comments?${q}`)).comments;
    },
    agentsStatus: () => call<AgentsStatus>('/agents/status'),
    subscribe(handler) {
      handlers.add(handler);
      stream ??= openStream();
      return () => {
        handlers.delete(handler);
        if (handlers.size === 0) {
          stream?.close();
          stream = null;
        }
      };
    },
  };
}
