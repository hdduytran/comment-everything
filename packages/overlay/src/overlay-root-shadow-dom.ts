import type { Comment } from '@comment-everything/core/browser';
import { SidePanel, type PanelModel } from './comment-side-panel.js';
import { createShadowHost } from './dom-helpers.js';
import type { CaptureMode, OverlayHandle, OverlayHost } from './host-adapter.js';
import { OVERLAY_CSS } from './overlay-styles.js';
import { DraftStore, buildPrompt } from './overlay-state.js';

/** Clipboard write with a fallback for pages where the async clipboard API is unavailable. */
async function defaultCopyText(doc: Document, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fall through to the legacy path
  }
  const area = doc.createElement('textarea');
  area.value = text;
  area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  doc.body.append(area);
  area.select();
  const ok = doc.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('Clipboard is not available');
}

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

  const say = (text: string, error = false) => {
    state.message = { text, error };
    render();
  };

  const panel = new SidePanel(
    doc,
    {
      setMode(mode) {
        state.mode = mode;
        host.content.setMode(mode);
        render();
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
          await (host.copyText?.(text) ?? defaultCopyText(doc, text));
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
          const batch = await host.daemon.sendBatch(store.toInputs(host.source));
          for (const c of batch.comments) sent.set(c.id, c);
          const count = batch.comments.length;
          store.clear();
          state.busy = false;
          say(`Sent ${count} comment${count === 1 ? '' : 's'}.`);
        } catch (err) {
          state.busy = false;
          say(`Send failed: ${(err as Error).message}`, true);
        }
      },
    },
    { modes: host.content.modes, emptyHint: host.content.emptyHint },
  );

  function render(): void {
    panel.update({
      mode: state.mode,
      drafts: store.drafts,
      sent: [...sent.values()],
      busy: state.busy,
      message: state.message,
    });
    const pins = store.pins();
    const key = JSON.stringify(pins);
    if (key !== pinsKey) {
      pinsKey = key;
      host.content.setPins(pins);
    }
  }

  const { host: hostEl, shadow } = createShadowHost(doc, mountPoint, OVERLAY_CSS);
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
      if (e.type === 'ready') {
        void refresh();
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
  render();

  return {
    pendingCount: () => store.drafts.length,
    dispose() {
      offs.forEach((off) => off());
      host.content.setMode(null);
      host.content.setPins([]);
      hostEl.remove();
    },
  };
}
