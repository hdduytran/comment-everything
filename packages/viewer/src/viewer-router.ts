import { mountHtmlViewer } from './html-iframe-viewer.js';
import { mountMediaViewer } from './media-viewer.js';
import { mountMarkdownViewer } from './markdown-line-mapped-viewer.js';
import type { ViewerMount } from './viewer-config.js';

export type ViewerKind = 'html' | 'markdown' | 'video' | 'audio' | 'unsupported';

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac']);

/** Choose a viewer from the file extension. */
export function viewerKindFor(source: string): ViewerKind {
  const ext = /\.([^./]+)$/.exec(source.toLowerCase())?.[1];
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext && VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (ext && AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return 'unsupported';
}

const MOUNTS: Record<Exclude<ViewerKind, 'unsupported'>, ViewerMount> = {
  html: mountHtmlViewer,
  markdown: mountMarkdownViewer,
  video: mountMediaViewer,
  audio: mountMediaViewer,
};

export function viewerFor(source: string): ViewerMount | null {
  const kind = viewerKindFor(source);
  return kind === 'unsupported' ? null : MOUNTS[kind];
}
