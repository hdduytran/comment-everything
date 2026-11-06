import type { CommentPatch } from '@comment-everything/core';
import { AGENT_HEADER } from './agents-routes.js';
import { TOKEN_HEADER } from './auth-token-and-origin-guard.js';
import type { AssetBlob, CommentBackend, CommentWithRoot, ListFilter } from './comment-service.js';
import type { SentBatch } from './comment-events-sse.js';

/** `CommentBackend` that talks to a running daemon over its REST API (used by `mcp` stdio). */
export class HttpCommentBackend implements CommentBackend {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    /** Identifies this proxy to the daemon's agent tracking (see `/agents/hello`). */
    private readonly agentId?: string,
  ) {}

  private async request(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set(TOKEN_HEADER, this.token);
    if (this.agentId) headers.set(AGENT_HEADER, this.agentId);
    if (init.body) headers.set('Content-Type', 'application/json');
    return fetch(new URL(pathAndQuery, this.baseUrl), { ...init, headers });
  }

  private async json<T>(res: Response): Promise<T> {
    if (!res.ok)
      throw new Error(`Daemon responded ${res.status}: ${await res.text().catch(() => '')}`);
    return (await res.json()) as T;
  }

  async list(filter: ListFilter = {}): Promise<CommentWithRoot[]> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) if (v !== undefined) q.set(k, v);
    const res = await this.request(`/comments?${q}`);
    return (await this.json<{ comments: CommentWithRoot[] }>(res)).comments;
  }

  async get(id: string): Promise<CommentWithRoot | null> {
    const res = await this.request(`/comments/${encodeURIComponent(id)}`);
    return res.status === 404 ? null : this.json<CommentWithRoot>(res);
  }

  async update(id: string, patch: CommentPatch): Promise<CommentWithRoot | null> {
    const res = await this.request(`/comments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return res.status === 404 ? null : this.json<CommentWithRoot>(res);
  }

  async readAsset(id: string, asset: string): Promise<AssetBlob | null> {
    const res = await this.request(
      `/comments/${encodeURIComponent(id)}/asset?path=${encodeURIComponent(asset)}`,
    );
    if (!res.ok) return null;
    return {
      data: new Uint8Array(await res.arrayBuffer()),
      mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async waitForBatch(timeoutSec: number, signal?: AbortSignal): Promise<SentBatch | null> {
    const res = await this.request(`/batches/next?timeoutSec=${timeoutSec}`, { signal });
    return res.status === 204 ? null : this.json<SentBatch>(res);
  }
}
