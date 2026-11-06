import type { Comment } from '@comment-everything/core/browser';
import type { AgentIndicator } from './agent-status-text.js';
import type { EventIsolation } from './event-isolation.js';
import type { CaptureMode } from './host-adapter.js';
import type { Draft } from './overlay-state.js';

export interface PanelModel {
  mode: CaptureMode | null;
  drafts: readonly Draft[];
  sent: readonly Comment[];
  busy: boolean;
  message: { text: string; error: boolean; action?: 'connect' } | null;
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
}

export interface PanelOptions {
  modes?: readonly CaptureMode[];
  emptyHint?: string;
  isolation: EventIsolation;
  copyText(text: string): Promise<void>;
  onCollapsedChange?(collapsed: boolean): void;
}
