import type {
  Comment,
  CommentInput,
  CommentStatus,
  Selector,
} from '@comment-everything/core/browser';

/**
 * The host-adapter contract. The overlay UI never touches page content or the daemon directly:
 * a host (the local viewer today, the Chrome extension later) supplies a `ContentAdapter` that
 * captures anchors from the commented content and a `DaemonTransport` that talks to the daemon.
 */

export type CaptureMode = 'element' | 'text' | 'region';
export type Unsubscribe = () => void;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the user selected, before any text is written. */
export interface Anchor {
  selectors: Selector[];
  /** Short human preview (element tag + text, quoted text, "Region 300x120"). */
  label: string;
  /** Region captures carry the cropped image; the overlay uploads it and adds the selector. */
  screenshot?: { rect: Rect; png: Blob };
}

/** A numbered marker for one pending comment. `n` is the 1-based number shown to the user. */
export interface PinSpec {
  id: string;
  n: number;
  selectors: Selector[];
}

/** Everything the overlay needs from the commented content. */
export interface ContentAdapter {
  /** Capture modes to offer in the panel (default: all three). Media adapters offer none. */
  readonly modes?: readonly CaptureMode[];
  /** Text shown while no comment is pending (default: the element/text/region hint). */
  readonly emptyHint?: string;
  /** Start a capture mode (null stops capturing). Only one mode is active at a time. */
  setMode(mode: CaptureMode | null): void;
  onAnchor(cb: (anchor: Anchor) => void): Unsubscribe;
  onPinClick(cb: (id: string) => void): Unsubscribe;
  /** The user pressed Escape inside the content while a mode was active. */
  onCancel(cb: () => void): Unsubscribe;
  /** Replace all pins; the adapter re-resolves selectors itself (content may have changed). */
  setPins(pins: PinSpec[]): void;
  focusPin(id: string): void;
  /** Re-resolve and redraw pins after the content changed (reload, re-render). */
  refresh?(): void;
  dispose(): void;
}

/** One MCP client the daemon has seen (additive: hosts without agent tracking omit all of this). */
export interface AgentClientSummary {
  /** The client's own name, e.g. `claude-code` or `claude-ai`. */
  name: string;
  version?: string;
  transport: 'stdio' | 'http';
  /** Waiting in `wait_for_comments`, or using channel push. */
  watching: boolean;
  channel: boolean;
  lastSeenAt: string;
}

/** Which AI agents are connected to the daemon right now (`GET /agents/status`). */
export interface AgentsStatus {
  connected: AgentClientSummary[];
  /** At least one connected client picks up a Send without being asked. */
  watching: boolean;
  /** Any client has ever connected to this install. */
  everConnected: boolean;
}

export type DaemonEvent =
  | { type: 'ready' }
  | { type: 'comment.created' | 'comment.updated'; comment: Comment }
  | { type: 'comment.deleted'; id: string }
  | { type: 'batch.sent'; batchId: string; ids: string[] }
  | { type: 'file.changed'; root: string; path: string }
  | { type: 'agents.changed'; status: AgentsStatus };

/** Everything the overlay needs from the daemon, scoped to one source (file or URL). */
export interface DaemonTransport {
  /** The "Send" press: persist all comments as one batch. */
  sendBatch(comments: CommentInput[]): Promise<{ batchId: string; comments: Comment[] }>;
  /** Store a screenshot; resolves to its path relative to `.comments/`. */
  uploadAsset(image: Blob): Promise<string>;
  /** Existing comments for this source. */
  listComments(): Promise<Comment[]>;
  /** Optional: connected AI agents. When absent the panel shows no connection indicator. */
  agentsStatus?(): Promise<AgentsStatus>;
  /** Optional: let the user change a saved comment's status (standalone hosts). */
  updateStatus?(id: string, status: CommentStatus): Promise<Comment>;
  /** Optional: let the user delete a saved comment (standalone hosts). */
  deleteComment?(id: string): Promise<void>;
  /** Live events (SSE). The first subscriber opens the stream, the last one closes it. */
  subscribe(handler: (event: DaemonEvent) => void): Unsubscribe;
}

/** What a delivery action tells the user when it finishes. */
export interface DeliveryOutcome {
  text: string;
  /** Shown with a copy button in the toast (e.g. a sentence to paste into an agent). */
  copy?: { text: string; tip: string };
}

/** One button that hands comments to an AI without a daemon (export, open Claude, ...). */
export interface DeliveryAction {
  /** Stable key, used as `data-ce="delivery-<id>"`. */
  id: string;
  label: string;
  tip: string;
  /** The primary action receives the saved batch; secondary actions receive a snapshot of the pending drafts. */
  run(comments: Comment[]): Promise<DeliveryOutcome>;
}

/**
 * Replaces "Send" for hosts with no daemon to push to. Additive: omitted by the viewer and by
 * the extension in daemon mode, whose UI stays unchanged.
 */
export interface DeliveryConfig {
  /** Connection pill content (the host has no agent connection to describe). */
  mode: { label: string; tip: string };
  /** Replaces Send: the pending drafts are saved through `daemon.sendBatch`, then this runs. */
  primary: DeliveryAction;
  /** Extra buttons next to "Copy prompt". */
  secondary?: DeliveryAction[];
  /** Replaces the plain-text clipboard write of "Copy prompt" (e.g. rich text with images). */
  copyPrompt?(prompt: string, comments: Comment[]): Promise<void>;
  /** Prefix for asset paths in the prompt (default `.comments/`). */
  assetPrefix?: string;
}

/** A one-time call to action shown above the footer (e.g. "Move 3 local comments to the project"). */
export interface OverlayOffer {
  text: string;
  actionLabel: string;
  actionTip: string;
  /** Resolves to the confirmation text; the offer disappears on success and stays on failure. */
  run(): Promise<string>;
}

export interface OverlayHost {
  /** Relative file path or http(s) URL the comments belong to. */
  source: string;
  content: ContentAdapter;
  daemon: DaemonTransport;
  /** Element the overlay root is attached to (default: `document.body`). */
  mount?: HTMLElement;
  /** Clipboard write; defaults to `navigator.clipboard` with an execCommand fallback. */
  copyText?: (text: string) => Promise<void>;
  /** Clock for prompt timestamps (tests). */
  now?: () => Date;
  /** Standalone delivery (no daemon). When set, Send is replaced by `delivery.primary`. */
  delivery?: DeliveryConfig;
  offer?: OverlayOffer;
}

export interface OverlayHandle {
  /** Drafts currently pending (not yet sent). */
  pendingCount(): number;
  dispose(): void;
}
