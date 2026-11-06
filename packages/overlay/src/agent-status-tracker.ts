import type { AgentsStatus, DaemonEvent, DaemonTransport } from './host-adapter.js';

/**
 * Latest known connection state of AI agents. Stays `null` when the host's transport does not
 * implement `agentsStatus` or the daemon cannot be reached; the panel then hides the indicator.
 */
export class AgentStatusTracker {
  private status: AgentsStatus | null = null;

  constructor(
    private readonly daemon: DaemonTransport,
    private readonly onChange: () => void,
  ) {}

  get current(): AgentsStatus | null {
    return this.status;
  }

  async refresh(): Promise<AgentsStatus | null> {
    if (!this.daemon.agentsStatus) return null;
    try {
      this.status = await this.daemon.agentsStatus();
    } catch {
      this.status = null; // unknown is safer than a stale "connected"
    }
    this.onChange();
    return this.status;
  }

  /** Returns true when the event was an agent update (already applied). */
  handle(event: DaemonEvent): boolean {
    if (event.type !== 'agents.changed') return false;
    this.status = event.status;
    this.onChange();
    return true;
  }
}
