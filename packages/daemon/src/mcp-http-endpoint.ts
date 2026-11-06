import type { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AgentActivityRegistry } from './agent-activity-registry.js';
import type { CommentBackend } from './comment-service.js';
import { createMcpServer } from './mcp-server-tools.js';

interface ClientInfo {
  name: string;
  version?: string;
}

/** `clientInfo` from an `initialize` request (single message or JSON-RPC batch), if present. */
async function readClientInfo(req: Request): Promise<ClientInfo | null> {
  if (req.method !== 'POST') return null;
  try {
    const body: unknown = await req.clone().json();
    for (const msg of Array.isArray(body) ? body : [body]) {
      const m = msg as { method?: unknown; params?: { clientInfo?: Partial<ClientInfo> } };
      const info = m?.method === 'initialize' ? m.params?.clientInfo : undefined;
      if (info && typeof info.name === 'string' && info.name) {
        return {
          name: info.name,
          version: typeof info.version === 'string' ? info.version : undefined,
        };
      }
    }
  } catch {
    // not JSON: the transport reports the protocol error itself
  }
  return null;
}

/** Same backend, but a blocking wait counts the caller as "watching" while it lasts. */
function trackingBackend(
  backend: CommentBackend,
  agents: AgentActivityRegistry,
  id: string,
): CommentBackend {
  return {
    list: (f) => backend.list(f),
    get: (id2) => backend.get(id2),
    update: (id2, p) => backend.update(id2, p),
    readAsset: (id2, a) => backend.readAsset(id2, a),
    waitForBatch: (sec, signal) => agents.trackWait(id, () => backend.waitForBatch(sec, signal)),
  };
}

/**
 * Mount the Streamable HTTP MCP endpoint at `/mcp`. It is stateless: each request gets a
 * fresh server + transport and a single JSON response, which suits request/response tools
 * such as `wait_for_comments` (the call simply stays open until a batch arrives).
 * Token and Origin checks are applied by the app-wide guards.
 *
 * Stateless means no session id, so HTTP clients are told apart by their User-Agent; the
 * name comes from the `initialize` handshake when the request carries one.
 */
export function mountMcpHttpEndpoint(
  app: Hono,
  backend: CommentBackend,
  agents?: AgentActivityRegistry,
): void {
  app.all('/mcp', async (c) => {
    const ua = (c.req.header('user-agent') ?? 'unknown').slice(0, 100);
    const id = `http:${ua}`;
    if (agents) {
      const info = await readClientInfo(c.req.raw);
      if (info) agents.hello({ id, name: info.name, version: info.version, transport: 'http' });
      else if (agents.has(id)) agents.touch(id);
      else agents.hello({ id, name: ua.split(/[\/ ]/)[0] || 'MCP client', transport: 'http' });
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createMcpServer(agents ? trackingBackend(backend, agents, id) : backend);
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      // The JSON response is fully materialised by now; release the per-request server.
      void server.close().catch(() => undefined);
    }
  });
}
