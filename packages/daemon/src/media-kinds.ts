export type MediaKind = 'video' | 'audio';

const VIDEO = new Set(['mp4', 'webm', 'mov', 'mkv']);
const AUDIO = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac']);

/** Media kind from the file extension, or null for non-media sources (including URLs). */
export function mediaKindOf(source: string): MediaKind | null {
  if (/^https?:\/\//i.test(source)) return null;
  const ext = /\.([^./]+)$/.exec(source.toLowerCase())?.[1] ?? '';
  return VIDEO.has(ext) ? 'video' : AUDIO.has(ext) ? 'audio' : null;
}
