import { clearPairing, daemonBaseUrl, getDaemonPort, loadPairing } from './daemon-pairing.js';
import { probeDaemon } from './daemon-request-proxy.js';
import {
  AUTO_PROBE_TIMEOUT_MS,
  FORCED_PROBE_TIMEOUT_MS,
  getModePreference,
} from './extension-mode.js';
import type { RootInfo, StatusReply } from './extension-messages.js';
import type { KeyValueStore } from './key-value-store.js';
import { listMigratable } from './local-comment-store.js';
import { getMappedRoot, GLOBAL_FOLDER } from './origin-to-project-mapping.js';

async function fetchRoots(base: string, token: string): Promise<RootInfo[] | 'unauthorized'> {
  const res = await fetch(`${base}/roots`, { headers: { 'x-ce-token': token } });
  if (res.status === 401 || res.status === 403) return 'unauthorized';
  if (!res.ok) throw new Error(`Daemon responded ${res.status}`);
  return ((await res.json()) as { roots: RootInfo[] }).roots;
}

/**
 * What the page-side UI should do next, honouring the user's mode preference:
 * `standalone` never contacts a daemon; `auto` falls back to standalone when the daemon is
 * unreachable or this browser is not paired; `daemon` shows the setup cards instead.
 */
export async function computeStatus(store: KeyValueStore, origin: string): Promise<StatusReply> {
  const preference = await getModePreference(store);
  if (preference === 'standalone') return { state: 'standalone', reason: 'forced' };
  const auto = preference === 'auto';
  const status = await computeDaemonStatus(
    store,
    origin,
    auto ? AUTO_PROBE_TIMEOUT_MS : FORCED_PROBE_TIMEOUT_MS,
  );
  if (auto && (status.state === 'daemon-down' || status.state === 'unpaired')) {
    return { state: 'standalone', reason: status.state };
  }
  return status;
}

/**
 * Daemon-side status: show the "start the daemon" hint, ask to pair, pick a project for this
 * origin, or start commenting. A token the daemon no longer accepts is dropped.
 */
async function computeDaemonStatus(
  store: KeyValueStore,
  origin: string,
  probeTimeoutMs: number,
): Promise<StatusReply> {
  const port = await getDaemonPort(store);
  if (!(await probeDaemon(port, probeTimeoutMs))) return { state: 'daemon-down', port };

  const pairing = await loadPairing(store);
  if (!pairing) return { state: 'unpaired', port };

  const base = daemonBaseUrl(pairing.port);
  let roots: RootInfo[] | 'unauthorized';
  try {
    roots = await fetchRoots(base, pairing.token);
  } catch {
    return { state: 'daemon-down', port }; // transient failure: keep the pairing
  }
  if (roots === 'unauthorized') {
    await clearPairing(store);
    return { state: 'unpaired', port };
  }

  const mapped = await getMappedRoot(store, origin);
  const stillRegistered = mapped === GLOBAL_FOLDER || roots.some((r) => r.root === mapped);
  if (mapped === undefined || !stillRegistered) return { state: 'needs-root', origin, roots };
  return {
    state: 'ready',
    baseUrl: base,
    root: mapped === GLOBAL_FOLDER ? undefined : mapped,
    migratable: (await listMigratable(store, origin)).length,
  };
}
