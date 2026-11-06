import type { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { CommentBackend } from './comment-service.js';
import { createMcpServer } from './mcp-server-tools.js';

/**
 * Mount the Streamable HTTP MCP endpoint at `/mcp`. It is stateless: each request gets a
 * fresh server + transport and a single JSON response, which suits request/response tools
 * such as `wait_for_comments` (the call simply stays open until a batch arrives).
 * Token and Origin checks are applied by the app-wide guards.
 */
export function mountMcpHttpEndpoint(app: Hono, backend: CommentBackend): void {
  app.all('/mcp', async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createMcpServer(backend);
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      // The JSON response is fully materialised by now; release the per-request server.
      void server.close().catch(() => undefined);
    }
  });
}
