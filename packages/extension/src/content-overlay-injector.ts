import {
  createHttpDaemonTransport,
  createInPageContentAdapter,
  createOverlay,
  type DaemonTransport,
  type OverlayHost,
} from '@comment-everything/overlay';
import { ProxyEventSource, askWorker, proxyFetch } from './content-proxy-transport.js';
import type { StatusReply } from './extension-messages.js';
import { chromeLocalStore } from './key-value-store.js';
import { createWorkerAssetStore } from './local-asset-store.js';
import {
  createLocalTransport,
  listMigratable,
  removeLocalComments,
} from './local-comment-store.js';
import { migrateLocalComments } from './migrate-local-comments.js';
import { originOf, pageSource } from './origin-to-project-mapping.js';
import { showSetupBanner } from './setup-banner.js';
import { createStandaloneDelivery } from './standalone-delivery.js';
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

type ReadyStatus = Extract<StatusReply, { state: 'ready' }>;
type StandaloneStatus = Extract<StatusReply, { state: 'standalone' }>;

const plural = (n: number) => `${n} comment${n === 1 ? '' : 's'}`;

/** Daemon mode: offer to move comments saved while no daemon was used into the mapped project. */
function migrationOffer(
  daemon: DaemonTransport,
  origin: string,
  count: number,
): OverlayHost['offer'] {
  const store = chromeLocalStore();
  const assets = createWorkerAssetStore();
  return {
    text: `${plural(count)} saved in this browser (extension-only mode).`,
    actionLabel: `Move ${count} to project`,
    actionTip:
      'Send the comments saved in this browser to the project mapped to this site, then remove the local copies.',
    async run() {
      // Re-read: comments may have changed since the overlay opened.
      const comments = await listMigratable(store, origin);
      const moved = await migrateLocalComments({
        comments,
        assets,
        daemon,
        forget: (done) => removeLocalComments(store, assets, done),
      });
      return `Moved ${plural(moved)} to the project.`;
    },
  };
}

/** Standalone mode, daemon reachable but not paired: offer to pair for automatic Send. */
function pairingOffer(): OverlayHost['offer'] {
  return {
    text: 'A daemon is running on this computer. Pair to send comments straight to Claude.',
    actionLabel: 'Pair',
    actionTip: 'Open the daemon’s confirmation page. Comments saved here can be moved afterwards.',
    async run() {
      await askWorker({ type: 'ce:start-pairing' });
      return 'Confirm in the tab that opened, then reopen this panel.';
    },
  };
}

function startOverlay(status: ReadyStatus | StandaloneStatus): () => void {
  const source = pageSource(location.href);
  const report = (error: Error) => console.warn('[comment-everything]', error.message);
  const content = createTabScreenshotAdapter(createInPageContentAdapter({ onError: report }), {
    onError: report,
  });
  const host: OverlayHost = (() => {
    if (status.state === 'standalone') {
      const assets = createWorkerAssetStore();
      return {
        source,
        content,
        daemon: createLocalTransport({ source, store: chromeLocalStore(), assets }),
        delivery: createStandaloneDelivery({ host: location.host, assets }),
        offer: status.reason === 'unpaired' ? pairingOffer() : undefined,
      };
    }
    const daemon = createHttpDaemonTransport({
      baseUrl: status.baseUrl,
      token: 'held-by-service-worker',
      source,
      root: status.root,
      fetchImpl: proxyFetch,
      eventSourceImpl: ProxyEventSource as unknown as typeof EventSource,
    });
    const origin = originOf(location.href);
    return {
      source,
      content,
      daemon,
      offer:
        origin && status.migratable > 0
          ? migrationOffer(daemon, origin, status.migratable)
          : undefined,
    };
  })();
  const overlay = createOverlay(host);
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
  let waitingForPairing = false;

  const clear = () => {
    teardown?.();
    teardown = null;
  };

  const refresh = async () => {
    const mine = ++generation;
    clear();
    showingSetup = false;
    waitingForPairing = false;
    let status: StatusReply;
    try {
      status = await askWorker<StatusReply>({ type: 'ce:status' });
    } catch (err) {
      console.warn('[comment-everything] extension unavailable:', err);
      return;
    }
    if (mine !== generation) return; // toggled off or superseded while waiting
    if (status.state === 'ready' || status.state === 'standalone') {
      teardown = startOverlay(status);
      waitingForPairing = status.state === 'standalone' && status.reason === 'unpaired';
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
    if ((showingSetup || waitingForPairing) && area === 'local' && changes.pairing?.newValue) {
      void refresh();
    }
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
