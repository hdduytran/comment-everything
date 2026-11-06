import type { DaemonTransport } from '@comment-everything/overlay';
import type { ContentAdapter } from '@comment-everything/overlay';

/** Configuration the daemon embeds in the shell page (`<script id="ce-config">`). */
export interface ViewerConfig {
  token: string;
  rootId: string;
  /** Absolute project root. */
  root: string;
  /** File path relative to the root, posix separators. */
  source: string;
}

/** What a viewer hands back to the router so the overlay can attach to it. */
export interface MountedViewer {
  adapter: ContentAdapter;
  dispose(): void;
}

export type ViewerMount = (
  container: HTMLElement,
  cfg: ViewerConfig,
  daemon: DaemonTransport,
) => Promise<MountedViewer> | MountedViewer;

export function readViewerConfig(doc: Document = document): ViewerConfig {
  const node = doc.getElementById('ce-config');
  const raw: unknown = JSON.parse(node?.textContent ?? 'null');
  const cfg = raw as Partial<ViewerConfig> | null;
  if (!cfg || ![cfg.token, cfg.rootId, cfg.root, cfg.source].every((v) => typeof v === 'string')) {
    throw new Error('Viewer configuration is missing or malformed');
  }
  return cfg as ViewerConfig;
}

/** URL path (no origin) of a project file served by the daemon, token embedded in the path. */
export function fileUrl(cfg: ViewerConfig, relPath: string, withTokenInPath: boolean): string {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  const prefix = withTokenInPath ? `/s/${encodeURIComponent(cfg.token)}` : '';
  return `${prefix}/files/${cfg.rootId}/${encoded}`;
}
