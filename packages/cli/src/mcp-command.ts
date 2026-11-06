import { findProjectRoot } from '@comment-everything/core';
import { HttpCommentBackend, createMcpServer } from '@comment-everything/daemon';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { daemonRequest, ensureDaemon } from './daemon-launcher.js';
import { enableChannelCapability, startChannelPush } from './mcp-channel-push.js';

/**
 * MCP over stdio, proxying every tool call to the shared daemon. stdout carries only
 * protocol frames, so all diagnostics go to stderr. Resolves when the client disconnects.
 * With `channel`, sent batches are also pushed into the Claude Code session.
 */
export async function mcpCommand(opts: { port?: number; channel?: boolean }): Promise<number> {
  const daemon = await ensureDaemon(opts);

  // Claude Code launches MCP servers in the project directory: make its comments visible
  // without requiring the viewer to have been opened first. Too-broad roots are ignored.
  const projectRoot = findProjectRoot(process.cwd());
  if (projectRoot) {
    await daemonRequest(daemon, '/roots', { method: 'POST', body: { root: projectRoot } }).catch(
      (err: unknown) =>
        console.error(
          `comment-everything: not registering ${projectRoot}: ${(err as Error).message}`,
        ),
    );
  }

  const backend = new HttpCommentBackend(daemon.url, daemon.token);
  const server = createMcpServer(backend);
  if (opts.channel) enableChannelCapability(server);
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = () => resolve();
  });
  await server.connect(new StdioServerTransport());
  const stopPush = opts.channel ? startChannelPush(server, backend) : undefined;
  await closed;
  stopPush?.();
  return 0;
}
