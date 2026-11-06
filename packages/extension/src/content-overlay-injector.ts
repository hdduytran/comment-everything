import {
  createHttpDaemonTransport,
  createInPageContentAdapter,
  createOverlay,
} from '@comment-everything/overlay';
import { ProxyEventSource, askWorker, proxyFetch } from './content-proxy-transport.js';
import type { StatusReply } from './extension-messages.js';
import { pageSource } from './origin-to-project-mapping.js';
import { showSetupBanner } from './setup-banner.js';
import { createTabScreenshotAdapter } from './tab-screenshot-content-adapter.js';

interface ActiveSession {
  stop(): void;
}

declare global {
  interface Window {
    /** Present while the overlay (or its setup card) is open in this tab. */
    __ceExtension?: ActiveSession;
  }
}

function startOverlay(status: Extract<StatusReply, { state: 'ready' }>): () => void {
  const source = pageSource(location.href);
  const report = (error: Error) => console.warn('[comment-everything]', error.message);
  const content = createTabScreenshotAdapter(createInPageContentAdapter({ onError: report }), {
    onError: report,
  });
  const daemon = createHttpDaemonTransport({
    baseUrl: status.baseUrl,
    token: 'held-by-service-worker',
    source,
    root: status.root,
    fetchImpl: proxyFetch,
    eventSourceImpl: ProxyEventSource as unknown as typeof EventSource,
  });
  const overlay = createOverlay({ source, content, daemon });
  return () => {
    overlay.dispose();
    content.dispose();
  };
}

/** Run once per injection: a second injection into the same tab closes the first. */
function main(): void {
  if (window.__ceExtension) {
    window.__ceExtension.stop();
    delete window.__ceExtension;
    return;
  }

  let teardown: (() => void) | null = null;
  let generation = 0;
  let showingSetup = false;

  const clear = () => {
    teardown?.();
    teardown = null;
  };

  const refresh = async () => {
    const mine = ++generation;
    clear();
    showingSetup = false;
    let status: StatusReply;
    try {
      status = await askWorker<StatusReply>({ type: 'ce:status' });
    } catch (err) {
      console.warn('[comment-everything] extension unavailable:', err);
      return;
    }
    if (mine !== generation) return; // toggled off or superseded while waiting
    if (status.state === 'ready') {
      teardown = startOverlay(status);
      return;
    }
    showingSetup = true;
    teardown = showSetupBanner(document, status, {
      retry: () => void refresh(),
      pair: () => void askWorker({ type: 'ce:start-pairing' }),
      chooseRoot: (root) => void askWorker({ type: 'ce:set-root', root }).then(refresh),
    });
  };

  // Pairing completes in another tab; continue here as soon as the token is stored.
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (showingSetup && area === 'local' && changes.pairing?.newValue) void refresh();
  };
  chrome.storage.onChanged.addListener(onStorage);

  window.__ceExtension = {
    stop() {
      generation++;
      chrome.storage.onChanged.removeListener(onStorage);
      clear();
    },
  };
  void refresh();
}

main();
