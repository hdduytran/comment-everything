import type { Comment } from '@comment-everything/core/browser';
import type { DeliveryConfig, DeliveryOutcome, OverlayHost } from './host-adapter.js';
import { DraftStore, buildPrompt, draftsToComments } from './overlay-state.js';

export type Say = (
  text: string,
  error?: boolean,
  action?: 'connect',
  copy?: DeliveryOutcome['copy'],
) => void;

export interface DeliveryContext {
  host: OverlayHost;
  delivery: DeliveryConfig;
  store: DraftStore;
  sent: Map<string, Comment>;
  say: Say;
  setBusy(busy: boolean): void;
  /** Focus the draft that still has no text. */
  focusDraft(id: string): void;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Button behaviour for hosts without a daemon (see `DeliveryConfig`). The primary action saves
 * the pending drafts first and delivers the saved batch; "Copy prompt" and the secondary actions
 * work on the pending drafts as they are and leave them in place.
 */
export function createDeliveryActions(ctx: DeliveryContext) {
  const { host, delivery, store, say } = ctx;
  const snapshot = () => draftsToComments(store.drafts, host.source, host.now?.());

  return {
    async copy(fallback: (text: string) => Promise<void>): Promise<void> {
      const text = buildPrompt(store.drafts, host.source, host.now?.(), delivery.assetPrefix);
      await (delivery.copyPrompt ? delivery.copyPrompt(text, snapshot()) : fallback(text));
    },

    async send(): Promise<void> {
      const empty = store.drafts.find((d) => d.text.trim() === '');
      if (empty) {
        say('Write a comment for every pin before continuing.', true);
        ctx.focusDraft(empty.id);
        return;
      }
      ctx.setBusy(true);
      say('Saving…');
      let batch: Comment[];
      try {
        batch = (await host.daemon.sendBatch(store.toInputs(host.source))).comments;
      } catch (err) {
        ctx.setBusy(false);
        say(`Could not save: ${errorText(err)}`, true);
        return;
      }
      for (const c of batch) ctx.sent.set(c.id, c);
      store.clear();
      ctx.setBusy(false);
      try {
        const out = await delivery.primary.run(batch);
        say(out.text, false, undefined, out.copy);
      } catch (err) {
        const label = delivery.primary.label.toLowerCase();
        say(`Saved in this browser, but ${label} failed: ${errorText(err)}`, true);
      }
    },

    async deliver(id: string): Promise<void> {
      const action = delivery.secondary?.find((a) => a.id === id);
      if (!action || store.drafts.length === 0) return;
      try {
        const out = await action.run(snapshot());
        say(out.text, false, undefined, out.copy);
      } catch (err) {
        say(`${action.label} failed: ${errorText(err)}`, true);
      }
    },
  };
}
