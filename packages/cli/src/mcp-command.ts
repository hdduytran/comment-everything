import { findProjectRoot } from '@comment-everything/core';
import { HttpCommentBackend, createMcpServer } from '@comment-everything/daemon';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { daemonRequest, ensureDaemon } from './daemon-launcher.js';

/**
 * MCP over stdio, proxying every tool call to the shared daemon. stdout carries only
 * protocol frames, so all diagnostics go to stderr. Resolves when the client disconnects.
 */
export async function mcpCommand(opts: { port?: number }): Promise<number> {
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

  const server = createMcpServer(new HttpCommentBackend(daemon.url, daemon.token));
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = () => resolve();
  });
  await server.connect(new StdioServerTransport());
  await closed;
  return 0;
}
