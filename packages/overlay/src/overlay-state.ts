import {
  formatPrompt,
  type Comment,
  type CommentInput,
  type Selector,
} from '@comment-everything/core/browser';
import type { PinSpec } from './host-adapter.js';

/** A comment the user is still writing (not yet sent). */
export interface Draft {
  id: string;
  label: string;
  selectors: Selector[];
  text: string;
  /** Uploaded screenshot paths, relative to `.comments/`. */
  assets: string[];
}

let counter = 0;
const newDraftId = () => `draft-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Ordered list of pending drafts; the number shown to the user is the 1-based position. */
export class DraftStore {
  private list: Draft[] = [];
  private readonly listeners = new Set<() => void>();

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb());
  }

  get drafts(): readonly Draft[] {
    return this.list;
  }

  add(init: Omit<Draft, 'id' | 'text'> & { text?: string }): Draft {
    const draft: Draft = { id: newDraftId(), text: '', ...init };
    this.list = [...this.list, draft];
    this.emit();
    return draft;
  }

  /** Typing does not change structure, so listeners are not notified. */
  setText(id: string, text: string): void {
    const d = this.list.find((x) => x.id === id);
    if (d) d.text = text;
  }

  remove(id: string): void {
    this.list = this.list.filter((d) => d.id !== id);
    this.emit();
  }

  clear(): void {
    this.list = [];
    this.emit();
  }

  pins(): PinSpec[] {
    return this.list
      .map((d, i) => ({ id: d.id, n: i + 1, selectors: d.selectors }))
      .filter((p) => p.selectors.length > 0);
  }

  /** Payload for `POST /comments`. */
  toInputs(source: string): CommentInput[] {
    return this.list.map((d) => ({
      source,
      selectors: d.selectors,
      text: d.text.trim(),
      assets: d.assets,
    }));
  }
}

/** Materialize drafts as comments (placeholder ids/timestamps) so `formatPrompt` can render them. */
export function draftsToComments(
  drafts: readonly Draft[],
  source: string,
  now: Date = new Date(),
): Comment[] {
  const ts = now.toISOString();
  return drafts.map((d, i) => ({
    schemaVersion: 1,
    id: `draft-${i + 1}`,
    source,
    selectors: d.selectors,
    text: d.text.trim(),
    status: 'open',
    assets: d.assets,
    createdAt: ts,
    updatedAt: ts,
    batchId: 'draft',
  }));
}

/** The self-contained Markdown prompt for the pending drafts ("Copy prompt"). */
export function buildPrompt(
  drafts: readonly Draft[],
  source: string,
  now?: Date,
  assetPrefix?: string,
): string {
  return formatPrompt(draftsToComments(drafts, source, now), { assetPrefix });
}
