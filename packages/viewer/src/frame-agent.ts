import { createInPageContentAdapter } from '@comment-everything/overlay';
import {
  BRIDGE_TAG,
  parseParentMessage,
  type FrameMessage,
  type Untagged,
} from './frame-bridge-protocol.js';

/**
 * Runs inside the sandboxed (opaque-origin) HTML iframe. It captures elements, text selections
 * and screenshot regions, draws pins, and talks to the viewer only through postMessage.
 * It deliberately never reads `location`: the capability token lives in the frame URL and must
 * not be forwarded anywhere by this script.
 */
function start(): void {
  if (window.parent === window) return; // opened directly, not framed by the viewer

  // The viewer shares the origin this script was loaded from; use it to pin the message origin.
  const script = document.currentScript as HTMLScriptElement | null;
  const viewerOrigin = script ? new URL(script.src).origin : '*';

  const adapter = createInPageContentAdapter({
    doc: document,
    onError: (err) => console.warn('[comment-everything] capture failed:', err.message),
  });
  const send = (msg: Untagged<FrameMessage>) =>
    window.parent.postMessage({ tag: BRIDGE_TAG, ...msg }, viewerOrigin);

  adapter.onAnchor((a) => send({ kind: 'anchor', ...a }));
  adapter.onPinClick((id) => send({ kind: 'pin-click', id }));
  adapter.onCancel(() => send({ kind: 'cancel' }));

  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window.parent) return;
    if (viewerOrigin !== '*' && ev.origin !== viewerOrigin) return;
    const msg = parseParentMessage(ev.data);
    if (!msg) return;
    switch (msg.kind) {
      case 'set-mode':
        adapter.setMode(msg.mode);
        break;
      case 'set-pins':
        adapter.setPins(msg.pins);
        break;
      case 'focus-pin':
        adapter.focusPin(msg.id);
        break;
      case 'refresh':
        adapter.refresh?.();
        break;
    }
  });
  send({ kind: 'ready' });
}

start();
