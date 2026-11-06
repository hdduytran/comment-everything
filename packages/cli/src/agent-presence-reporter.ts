import { randomUUID } from 'node:crypto';
import { daemonRequest, type RunningDaemonInfo } from './daemon-launcher.js';

const HEARTBEAT_MS = 30_000;

/** Announces this stdio proxy (and the client behind it) to the daemon's agent tracking. */
export interface AgentPresence {
  readonly id: string;
  /** Call once the MCP handshake is done: reports `clientInfo` and starts the heartbeat. */
  start(): void;
  /** Tell the daemon this client is gone; safe to call more than once. */
  stop(): Promise<void>;
}

export function createAgentPresence(
  daemon: RunningDaemonInfo,
  /** The connected client's `clientInfo`, known only after the handshake. */
  getClientInfo: () => { name: string; version?: string } | undefined,
  channel: boolean,
): AgentPresence {
  const id = `stdio:${randomUUID()}`;
  let timer: NodeJS.Timeout | undefined;

  const hello = () => {
    const info = getClientInfo();
    return daemonRequest(daemon, '/agents/hello', {
      method: 'POST',
      body: {
        id,
        name: info?.name ?? 'MCP client',
        version: info?.version,
        transport: 'stdio',
        channel,
      },
    }).catch(() => undefined); // tracking is informational; never break the MCP session over it
  };

  return {
    id,
    start() {
      void hello();
      timer ??= setInterval(() => void hello(), HEARTBEAT_MS);
      timer.unref();
    },
    async stop() {
      clearInterval(timer);
      timer = undefined;
      await daemonRequest(daemon, '/agents/bye', { method: 'POST', body: { id } }).catch(
        () => undefined,
      );
    },
  };
}
