import type { Comment } from '@comment-everything/core/browser';
import type { AgentIndicator } from './agent-status-text.js';
import type { EventIsolation } from './event-isolation.js';
import type { CommentStatus } from '@comment-everything/core/browser';
import type { HelpTab } from './connect-help-content.js';
import type { CaptureMode, DeliveryConfig, DeliveryOutcome, OverlayOffer } from './host-adapter.js';
import type { Draft } from './overlay-state.js';

export interface PanelModel {
  mode: CaptureMode | null;
  drafts: readonly Draft[];
  sent: readonly Comment[];
  busy: boolean;
  message: {
    text: string;
    error: boolean;
    action?: 'connect';
    copy?: DeliveryOutcome['copy'];
  } | null;
  /** Connection indicator; null hides it (the host cannot report agent status). */
  agents: AgentIndicator | null;
}

export interface PanelActions {
  setMode(mode: CaptureMode | null): void;
  editDraft(id: string, text: string): void;
  removeDraft(id: string): void;
  focusDraft(id: string): void;
  send(): void;
  copy(): void;
  clear(): void;
  /** Esc with nothing else to dismiss: stop the active capture mode. Returns true if one was active. */
  cancelMode(): boolean;
  /** A secondary delivery button (standalone hosts only). */
  deliver(id: string): void;
  /** Saved comments can be edited when the transport supports it. */
  setStatus(id: string, status: CommentStatus): void;
  removeSaved(id: string): void;
  runOffer(): void;
}

export interface PanelOptions {
  modes?: readonly CaptureMode[];
  emptyHint?: string;
  isolation: EventIsolation;
  copyText(text: string): Promise<void>;
  onCollapsedChange?(collapsed: boolean): void;
  /** Standalone hosts: relabels Send and adds buttons. Absent = daemon UI, unchanged. */
  delivery?: Pick<DeliveryConfig, 'primary' | 'secondary'>;
  offer?: OverlayOffer;
  /** Show resolve / delete controls on saved comments. */
  editSaved?: boolean;
  helpTabs?: readonly HelpTab[];
  helpIntro?: string;
}
