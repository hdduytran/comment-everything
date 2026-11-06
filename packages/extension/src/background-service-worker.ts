import { acceptPairingMessage, beginPairing } from './daemon-pairing.js';
import { proxyDaemonFetch, streamDaemonEvents } from './daemon-request-proxy.js';
import {
  EVENTS_PORT,
  type CaptureReply,
  type StatusReply,
  type WorkerRequest,
} from './extension-messages.js';
import { computeStatus } from './extension-status.js';
import {
  SHIELD_PREF_KEY,
  rememberShieldOrigin,
  syncEarlyShield,
} from './early-shield-registration.js';
import { chromeLocalStore } from './key-value-store.js';
import { createIndexedDbAssetStore } from './local-asset-store.js';
import { originOf, setMappedRoot } from './origin-to-project-mapping.js';
import { handleStandaloneRequest } from './standalone-worker-handlers.js';

const store = chromeLocalStore();
const assets = createIndexedDbAssetStore();
const INJECTOR_FILE = 'content-overlay-injector.js';

/** Apply the early-shield settings; failures only cost the early shield, never the overlay. */
const syncShield = () =>
  syncEarlyShield(store, chrome).catch((err: unknown) =>
    console.warn('[comment-everything] early shield not updated:', err),
  );

/** Toolbar button and keyboard shortcut: inject (or toggle off) the overlay in the tab. */
async function toggleOverlay(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (tab?.id === undefined) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [INJECTOR_FILE] });
    const origin = originOf(tab.url ?? '');
    if (origin) {
      await rememberShieldOrigin(store, origin);
      void syncShield();
    }
  } catch (err) {
    // chrome:// pages, the Web Store and other restricted pages cannot be scripted.
    console.warn('[comment-everything] cannot comment on this page:', err);
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#b91c1c' });
  }
}

chrome.action.onClicked.addListener((tab) => void toggleOverlay(tab));

async function captureTab(windowId: number | undefined): Promise<CaptureReply> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(
      windowId ?? chrome.windows.WINDOW_ID_CURRENT,
      {
        format: 'png',
      },
    );
    return { ok: true, dataUrl };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleRequest(
  req: WorkerRequest,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const pageUrl = sender.tab?.url ?? '';
  const standalone = await handleStandaloneRequest(req, {
    store,
    assets,
    downloads: chrome.downloads,
    openTab: (url) => chrome.tabs.create({ url }),
  });
  if (standalone) return standalone;
  switch (req.type) {
    case 'ce:status': {
      const origin = originOf(pageUrl);
      if (!origin) return { state: 'daemon-down', port: 0 } satisfies StatusReply;
      return computeStatus(store, origin);
    }
    case 'ce:start-pairing': {
      await chrome.tabs.create({ url: await beginPairing(store, chrome.runtime.id) });
      return { ok: true };
    }
    case 'ce:set-root': {
      const origin = originOf(pageUrl);
      if (!origin) return { ok: false };
      await setMappedRoot(store, origin, req.root);
      return { ok: true };
    }
    case 'ce:capture':
      return captureTab(sender.tab?.windowId);
    case 'ce:fetch':
      return proxyDaemonFetch(store, req);
    default:
      return { ok: false, error: 'Unknown request' };
  }
}

chrome.runtime.onMessage.addListener((message: WorkerRequest, sender, sendResponse) => {
  // Only this extension's own content scripts may drive the worker.
  if (sender.id !== chrome.runtime.id || !sender.tab) return false;
  handleRequest(message, sender).then(sendResponse, (err: unknown) =>
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});

/** The daemon's confirmation page hands over the token via `externally_connectable`. */
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  acceptPairingMessage(store, message, { url: sender.url }).then(
    (ok) => sendResponse({ ok }),
    () => sendResponse({ ok: false }),
  );
  return true;
});

/** Relay the daemon's SSE stream to a page; closing the port (page gone) stops the stream. */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== EVENTS_PORT || port.sender?.id !== chrome.runtime.id) return;
  const abort = new AbortController();
  port.onDisconnect.addListener(() => abort.abort());
  streamDaemonEvents(store, (frame) => port.postMessage(frame), abort.signal).then(
    () => port.disconnect(),
    (err: unknown) => {
      if (!abort.signal.aborted) {
        console.warn('[comment-everything] event stream ended; the page will reconnect.', err);
        port.disconnect();
      }
    },
  );
});

// Early shield: re-sync when the user flips the option or grants / revokes site access.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && SHIELD_PREF_KEY in changes) void syncShield();
});
chrome.permissions.onAdded.addListener(() => void syncShield());
chrome.permissions.onRemoved.addListener(() => void syncShield());
chrome.runtime.onStartup.addListener(() => void syncShield());
chrome.runtime.onInstalled.addListener(() => void syncShield());
