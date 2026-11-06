import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CommentBackend } from '@comment-everything/daemon';
import { formatCommentList } from '@comment-everything/daemon';

/** Claude Code "channels" capability key (research preview; see the plugin docs). */
export const CHANNEL_CAPABILITY = 'claude/channel';
export const CHANNEL_METHOD = 'notifications/claude/channel';

const POLL_SEC = 60;
const RETRY_DELAY_MS = 2_000;

/**
 * Declare the channel capability; must run before the server connects. Claude Code only
 * delivers the notifications when the session opts in (`--channels` or the development
 * flag), so this stays behind `mcp --channel` rather than being on by default.
 */
export function enableChannelCapability(server: McpServer): void {
  server.server.registerCapabilities({ experimental: { [CHANNEL_CAPABILITY]: {} } });
}

/**
 * Push every Send batch into the Claude Code session as a channel notification. This claims
 * batches from the daemon queue, so a channel-mode server must not also be used with
 * `wait_for_comments`. Returns a stop function.
 */
export function startChannelPush(server: McpServer, backend: CommentBackend): () => void {
  const abort = new AbortController();

  const loop = async (): Promise<void> => {
    while (!abort.signal.aborted) {
      try {
        const batch = await backend.waitForBatch(POLL_SEC, abort.signal);
        if (!batch) continue;
        // Custom method outside the SDK's typed notification union.
        await server.server.notification({
          method: CHANNEL_METHOD,
          params: {
            content: formatCommentList(batch.comments, `New batch ${batch.batchId} — comments`),
            meta: { batch_id: batch.batchId, count: String(batch.comments.length) },
          },
        } as never);
      } catch (err) {
        if (abort.signal.aborted) return;
        console.error(`comment-everything: channel push failed: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  };
  void loop();
  return () => abort.abort();
}
