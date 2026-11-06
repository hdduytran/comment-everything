import type { Comment } from '@comment-everything/core/browser';
import type { OverlayHost } from './host-adapter.js';
import type { PanelActions } from './panel-types.js';
import type { Say } from './overlay-delivery.js';

export interface SavedActionsContext {
  host: OverlayHost;
  sent: Map<string, Comment>;
  say: Say;
  render(): void;
  setBusy(busy: boolean): void;
  hideOffer(): void;
  /** Reload the saved comments (after an offer moved some in). */
  reload(): Promise<void>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Panel actions for saved comments the transport lets the user change (resolve, delete) and for
 * the host's one-time offer. They only run when the host supplied the matching capability.
 */
export function createSavedActions(
  ctx: SavedActionsContext,
): Pick<PanelActions, 'setStatus' | 'removeSaved' | 'runOffer'> {
  const { host, sent, say } = ctx;
  return {
    async setStatus(id, status) {
      try {
        const updated = await host.daemon.updateStatus?.(id, status);
        if (updated) sent.set(updated.id, updated);
        ctx.render();
      } catch (err) {
        say(`Update failed: ${message(err)}`, true);
      }
    },
    async removeSaved(id) {
      try {
        await host.daemon.deleteComment?.(id);
        sent.delete(id);
        ctx.render();
      } catch (err) {
        say(`Delete failed: ${message(err)}`, true);
      }
    },
    async runOffer() {
      if (!host.offer) return;
      ctx.setBusy(true);
      try {
        const done = await host.offer.run();
        ctx.hideOffer();
        ctx.setBusy(false);
        say(done);
        await ctx.reload();
      } catch (err) {
        ctx.setBusy(false);
        say(message(err), true);
      }
    },
  };
}
