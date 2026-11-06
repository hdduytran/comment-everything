import type { Comment, CommentInput } from '@comment-everything/core/browser';
import { vi } from 'vitest';
import type {
  AgentsStatus,
  Anchor,
  ContentAdapter,
  DaemonEvent,
  DaemonTransport,
} from '../src/host-adapter.js';

export function fakeContent() {
  const anchorCbs = new Set<(a: Anchor) => void>();
  const modes: (string | null)[] = [];
  const adapter: ContentAdapter = {
    setMode: (m) => void modes.push(m),
    onAnchor: (cb) => (anchorCbs.add(cb), () => anchorCbs.delete(cb)),
    onPinClick: () => () => undefined,
    onCancel: () => () => undefined,
    setPins: () => undefined,
    focusPin: () => undefined,
    dispose: () => undefined,
  };
  return { adapter, modes, emit: (a: Anchor) => anchorCbs.forEach((cb) => cb(a)) };
}

export const noAgents: AgentsStatus = { connected: [], watching: false, everConnected: false };
export const agent = (name: string, watching: boolean): AgentsStatus => ({
  connected: [
    { name, transport: 'stdio', watching, channel: false, lastSeenAt: '2026-11-06T04:00:00.000Z' },
  ],
  watching,
  everConnected: true,
});

export function fakeDaemon(status?: AgentsStatus) {
  let handler: ((e: DaemonEvent) => void) | undefined;
  let current = status;
  const sent = (c: CommentInput, i: number): Comment => ({
    schemaVersion: 1,
    id: `c${i + 1}`,
    source: c.source,
    selectors: (c.selectors ?? []) as Comment['selectors'],
    text: c.text,
    status: 'open',
    assets: [],
    createdAt: '2026-11-06T04:00:00.000Z',
    updatedAt: '2026-11-06T04:00:00.000Z',
    batchId: 'b1',
  });
  const daemon: DaemonTransport = {
    sendBatch: vi.fn(async (comments: CommentInput[]) => ({
      batchId: 'b1',
      comments: comments.map(sent),
    })),
    uploadAsset: vi.fn(async () => 'assets/shot.png'),
    listComments: vi.fn(async () => []),
    subscribe: (h) => ((handler = h), () => (handler = undefined)),
    ...(status ? { agentsStatus: vi.fn(async () => current as AgentsStatus) } : {}),
  };
  return {
    daemon,
    push: (e: DaemonEvent) => handler?.(e),
    setStatus: (s: AgentsStatus) => (current = s),
  };
}

export const anchor = (css: string, label: string): Anchor => ({
  selectors: [{ type: 'CssSelector', value: css }],
  label,
});

/** What a real keystroke or edit looks like to listeners: it bubbles and crosses shadow roots. */
export const realEvent = <T extends Event>(
  Ctor: new (type: string, init: object) => T,
  type: string,
  init = {},
) => new Ctor(type, { bubbles: true, composed: true, cancelable: true, ...init });

export const tick = () => new Promise((r) => setTimeout(r, 0));
