import type { Comment } from '@comment-everything/core/browser';
import { AgentStatusTracker } from './agent-status-tracker.js';
import { describeAgents, describeSendOutcome } from './agent-status-text.js';
import { defaultCopyText } from './clipboard-copy.js';
import { SidePanel, type PanelModel } from './comment-side-panel.js';
import { EventIsolation } from './event-isolation.js';
import { createShadowHost } from './dom-helpers.js';
import type { CaptureMode, OverlayHandle, OverlayHost } from './host-adapter.js';
import { OVERLAY_CSS } from './overlay-styles.js';
import { DraftStore, buildPrompt } from './overlay-state.js';

const MESSAGE_MS = 8_000;

/**
 * Mount the commenting overlay: a Shadow-DOM side panel wired to the host's content adapter
 * (capturing anchors, drawing pins) and daemon transport (Send, live status over SSE).
 */
export function createOverlay(host: OverlayHost): OverlayHandle {
  const mountPoint = host.mount ?? document.body;
  const doc = mountPoint.ownerDocument;
  const store = new DraftStore();
  const sent = new Map<string, Comment>();
  const state = {
    mode: null as CaptureMode | null,
    busy: false,
    message: null as PanelModel['message'],
  };
  let pinsKey = '';
  let messageTimer: ReturnType<typeof setTimeout> | undefined;
  const copyText = (text: string) => host.copyText?.(text) ?? defaultCopyText(doc, text);

  /** Routine confirmations fade after a while; errors and calls to action stay until replaced. */
  const say = (text: string, error = false, action?: 'connect') => {
    clearTimeout(messageTimer);
    state.message = { text, error, ...(action ? { action } : {}) };
    if (!error && !action) {
      messageTimer = setTimeout(() => {
        state.message = null;
        render();
      }, MESSAGE_MS);
    }
    render();
  };
  const agents: AgentStatusTracker = new AgentStatusTracker(host.daemon, () => {
    // "Connect Claude" is stale once a client shows up.
    if (state.message?.action === 'connect' && agents.current?.connected.length) {
      state.message = null;
    }
    render();
  });

  // The shadow host exists before the panel so event isolation can be installed around it.
  const { host: hostEl, shadow } = createShadowHost(doc, mountPoint, OVERLAY_CSS);
  hostEl.dataset.cePanel = 'open';
  const isolation = new EventIsolation(hostEl, doc.defaultView ?? window);

  const panel = new SidePanel(
    doc,
    {
      setMode(mode) {
        state.mode = mode;
        host.content.setMode(mode);
        render();
      },
      cancelMode() {
        if (!state.mode) return false;
        state.mode = null;
        host.content.setMode(null);
        render();
        return true;
      },
      editDraft: (id, text) => store.setText(id, text),
      removeDraft: (id) => store.remove(id),
      focusDraft: (id) => host.content.focusPin(id),
      clear: () => {
        store.clear();
        say('Cleared pending comments.');
      },
      async copy() {
        try {
          const text = buildPrompt(store.drafts, host.source, host.now?.());
          await copyText(text);
          say('Prompt copied to clipboard.');
        } catch (err) {
          say(`Copy failed: ${(err as Error).message}`, true);
        }
      },
      async send() {
        const empty = store.drafts.find((d) => d.text.trim() === '');
        if (empty) {
          say('Write a comment for every pin before sending.', true);
          panel.focusDraft(empty.id);
          return;
        }
        state.busy = true;
        say('Sending…');
        try {
          // Ask before sending: a watcher that is waiting claims the batch immediately after.
          const status = await agents.refresh();
          const batch = await host.daemon.sendBatch(store.toInputs(host.source));
          for (const c of batch.comments) sent.set(c.id, c);
          const count = batch.comments.length;
          store.clear();
          state.busy = false;
          const outcome = describeSendOutcome(status, count);
          say(outcome.text, false, outcome.action);
        } catch (err) {
          state.busy = false;
          say(`Send failed: ${(err as Error).message}`, true);
        }
      },
    },
    {
      modes: host.content.modes,
      emptyHint: host.content.emptyHint,
      isolation,
      copyText,
      onCollapsedChange: (c) => (hostEl.dataset.cePanel = c ? 'collapsed' : 'open'),
    },
  );

  function render(): void {
    panel.update({
      mode: state.mode,
      drafts: store.drafts,
      sent: [...sent.values()],
      busy: state.busy,
      message: state.message,
      agents: describeAgents(agents.current),
    });
    const pins = store.pins();
    const key = JSON.stringify(pins);
    if (key !== pinsKey) {
      pinsKey = key;
      host.content.setPins(pins);
    }
  }

  shadow.append(panel.root);

  const offs = [
    store.onChange(render),
    host.content.onAnchor(async (anchor) => {
      try {
        const selectors = [...anchor.selectors];
        const assets: string[] = [];
        if (anchor.screenshot) {
          const asset = await host.daemon.uploadAsset(anchor.screenshot.png);
          selectors.push({ type: 'ScreenshotSelector', rect: anchor.screenshot.rect, asset });
          assets.push(asset);
        }
        const draft = store.add({ label: anchor.label, selectors, assets });
        panel.focusDraft(draft.id);
      } catch (err) {
        say(`Could not capture: ${(err as Error).message}`, true);
      }
    }),
    host.content.onPinClick((id) => panel.focusDraft(id)),
    host.content.onCancel(() => {
      state.mode = null;
      host.content.setMode(null);
      render();
    }),
    host.daemon.subscribe((e) => {
      if (agents.handle(e)) return;
      if (e.type === 'ready') {
        void refresh();
        void agents.refresh();
        return;
      }
      if (e.type === 'comment.created' || e.type === 'comment.updated') {
        if (e.comment.source === host.source) sent.set(e.comment.id, e.comment);
      } else if (e.type === 'comment.deleted') {
        sent.delete(e.id);
      } else {
        return;
      }
      render();
    }),
  ];

  /** Load comments already stored for this source (also after an SSE reconnect). */
  async function refresh(): Promise<void> {
    try {
      for (const c of await host.daemon.listComments()) sent.set(c.id, c);
      render();
    } catch (err) {
      say(`Could not load comments: ${(err as Error).message}`, true);
    }
  }
  void refresh();
  void agents.refresh();
  render();

  return {
    pendingCount: () => store.drafts.length,
    dispose() {
      offs.forEach((off) => off());
      clearTimeout(messageTimer);
      isolation.dispose();
      panel.dispose();
      host.content.setMode(null);
      host.content.setPins([]);
      hostEl.remove();
    },
  };
}
