import { mountHtmlViewer } from './html-iframe-viewer.js';
import { mountMarkdownViewer } from './markdown-line-mapped-viewer.js';
import type { ViewerMount } from './viewer-config.js';

export type ViewerKind = 'html' | 'markdown' | 'unsupported';

/** Choose a viewer from the file extension. */
export function viewerKindFor(source: string): ViewerKind {
  const ext = /\.([^./]+)$/.exec(source.toLowerCase())?.[1];
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  return 'unsupported';
}

const MOUNTS: Record<Exclude<ViewerKind, 'unsupported'>, ViewerMount> = {
  html: mountHtmlViewer,
  markdown: mountMarkdownViewer,
};

export function viewerFor(source: string): ViewerMount | null {
  const kind = viewerKindFor(source);
  return kind === 'unsupported' ? null : MOUNTS[kind];
}
