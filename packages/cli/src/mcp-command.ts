import { findProjectRoot } from '@comment-everything/core';
import { HttpCommentBackend, createMcpServer } from '@comment-everything/daemon';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { daemonRequest, ensureDaemon } from './daemon-launcher.js';
import { createAgentPresence } from './agent-presence-reporter.js';
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

  // The presence reporter reads the client's identity lazily, after the MCP handshake.
  const presence = createAgentPresence(
    daemon,
    () => server.server.getClientVersion(),
    !!opts.channel,
  );
  const backend = new HttpCommentBackend(daemon.url, daemon.token, presence.id);
  const server = createMcpServer(backend);
  if (opts.channel) enableChannelCapability(server);
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = () => resolve();
  });
  server.server.oninitialized = () => presence.start();
  await server.connect(new StdioServerTransport());
  const stopPush = opts.channel ? startChannelPush(server, backend) : undefined;
  // The client may end the session by closing stdin or signalling the process instead of a
  // protocol-level close; either way the daemon should hear that this agent is gone.
  const ended = new Promise<void>((resolve) => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => resolve());
    process.stdin.once('end', () => resolve());
  });
  await Promise.race([closed, ended]);
  stopPush?.();
  await presence.stop();
  return 0;
}
