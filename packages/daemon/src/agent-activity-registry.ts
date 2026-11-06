import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { globalDataDir, writeFileAtomic } from '@comment-everything/core';
import { resolveHome } from './daemon-lockfile.js';

export type AgentTransport = 'stdio' | 'http';

/** What an MCP client tells us about itself (`clientInfo` from the MCP initialize handshake). */
export interface AgentHello {
  /** Stable per connection: random for stdio proxies, derived from the User-Agent for /mcp. */
  id: string;
  name: string;
  version?: string;
  transport: AgentTransport;
  /** Channel push mode: the client receives batches without asking. */
  channel?: boolean;
}

export interface AgentClientStatus {
  name: string;
  version?: string;
  transport: AgentTransport;
  /** Someone is blocked in wait_for_comments, or the client uses channel push. */
  watching: boolean;
  channel: boolean;
  lastSeenAt: string;
}

export interface AgentsStatus {
  /** Clients seen recently enough to count as connected. */
  connected: AgentClientStatus[];
  /** True when at least one connected client will pick up a Send without being asked. */
  watching: boolean;
  /** True once any MCP client has ever connected to this install. */
  everConnected: boolean;
}

interface Entry extends AgentHello {
  lastSeen: number;
  waiting: number;
}

/** stdio proxies heartbeat every 30s; /mcp clients only speak when they make a call. */
export const STDIO_TTL_MS = 90_000;
export const HTTP_TTL_MS = 10 * 60_000;
const SWEEP_MS = 15_000;
const MAX_CLIENTS = 50;
const MAX_NAME = 64;

const clip = (s: string) => s.slice(0, MAX_NAME);

/**
 * Tracks which MCP clients talk to the daemon and whether any of them is waiting for comments.
 * The only persisted fact is "a client connected at least once" (drives the first-run hint).
 */
export class AgentActivityRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly seenFile: string;
  private ever = false;
  private lastSummary = '';
  private timer: NodeJS.Timeout | undefined;

  constructor(
    home: string | undefined,
    private readonly onChange: (status: AgentsStatus) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.seenFile = path.join(globalDataDir(resolveHome(home)), 'agents-seen.json');
  }

  async load(): Promise<void> {
    try {
      this.ever =
        (JSON.parse(await readFile(this.seenFile, 'utf8')) as { seen?: boolean }).seen === true;
    } catch {
      this.ever = false;
    }
  }

  start(): void {
    this.timer ??= setInterval(() => this.emitIfChanged(), SWEEP_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Register or refresh a client (idempotent; proxies call it again as a heartbeat). */
  hello(hello: AgentHello): void {
    const prev = this.entries.get(hello.id);
    if (!prev && this.entries.size >= MAX_CLIENTS) this.evictOldest();
    this.entries.set(hello.id, {
      ...hello,
      name: clip(hello.name),
      version: hello.version && clip(hello.version),
      waiting: prev?.waiting ?? 0,
      lastSeen: this.now(),
    });
    this.markEverConnected();
    this.emitIfChanged();
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Refresh liveness of a known client without announcing anything. */
  touch(id: string | undefined): void {
    const e = id ? this.entries.get(id) : undefined;
    if (e) e.lastSeen = this.now();
  }

  bye(id: string): void {
    if (this.entries.delete(id)) this.emitIfChanged();
  }

  /** Run `fn` (a blocking wait for comments) while counting `id` as watching. */
  async trackWait<T>(id: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!id) return fn();
    if (!this.entries.has(id)) {
      this.hello({ id, name: 'MCP client', transport: 'stdio' });
    }
    const e = this.entries.get(id);
    if (e) e.waiting++;
    this.touch(id);
    this.emitIfChanged();
    try {
      return await fn();
    } finally {
      const cur = this.entries.get(id);
      if (cur) {
        cur.waiting = Math.max(0, cur.waiting - 1);
        cur.lastSeen = this.now();
      }
      this.emitIfChanged();
    }
  }

  status(): AgentsStatus {
    const t = this.now();
    const connected = [...this.entries.values()]
      .filter(
        (e) =>
          e.waiting > 0 || t - e.lastSeen <= (e.transport === 'stdio' ? STDIO_TTL_MS : HTTP_TTL_MS),
      )
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map<AgentClientStatus>((e) => ({
        name: e.name,
        ...(e.version ? { version: e.version } : {}),
        transport: e.transport,
        watching: e.waiting > 0 || e.channel === true,
        channel: e.channel === true,
        lastSeenAt: new Date(e.lastSeen).toISOString(),
      }));
    return { connected, watching: connected.some((c) => c.watching), everConnected: this.ever };
  }

  private emitIfChanged(): void {
    const s = this.status();
    // lastSeenAt changes constantly; only membership and watching state are news.
    const summary = JSON.stringify([
      s.everConnected,
      s.connected.map((c) => [c.name, c.transport, c.watching, c.channel]),
    ]);
    if (summary === this.lastSummary) return;
    this.lastSummary = summary;
    this.onChange(s);
  }

  private evictOldest(): void {
    let oldest: [string, number] | undefined;
    for (const [id, e] of this.entries)
      if (!oldest || e.lastSeen < oldest[1]) oldest = [id, e.lastSeen];
    if (oldest) this.entries.delete(oldest[0]);
  }

  private markEverConnected(): void {
    if (this.ever) return;
    this.ever = true;
    void mkdir(path.dirname(this.seenFile), { recursive: true })
      .then(() => writeFileAtomic(this.seenFile, JSON.stringify({ seen: true })))
      .catch(() => undefined); // best effort: only affects whether the first-run hint repeats
  }
}
