import { createControlsBar } from './media-controls-bar.js';
import { createMediaContentAdapter } from './media-content-adapter.js';
import { bindMediaShortcuts, type MediaAction } from './media-keyboard-shortcuts.js';
import { createThumbnailStrip, type ThumbnailStrip } from './video-thumbnail-strip.js';
import { fileUrl, type ViewerMount } from './viewer-config.js';
import {
  MAX_WAVEFORM_BYTES,
  createWaveformRangeSelector,
  type RangeSpec,
} from './waveform-range-selector.js';

const DEFAULT_FPS = 30;
const AUDIO_STEP_SEC = 0.1;

/** Total byte size of a served file via a one-byte range request, or null when unknown. */
async function fileSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    const total = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1];
    await res.body?.cancel();
    return total ? Number(total) : null;
  } catch {
    return null;
  }
}

/** Learn the frame duration from consecutive presented frames (falls back to 30 fps). */
function trackFrameDuration(video: HTMLVideoElement): () => number {
  let frame = 1 / DEFAULT_FPS;
  let last: number | null = null;
  const tick = (_now: number, meta: VideoFrameCallbackMetadata) => {
    if (last !== null) {
      const d = meta.mediaTime - last;
      if (d > 1 / 240 && d < 0.25 && d < frame * 1.5) frame = Math.min(frame, d);
    }
    last = meta.mediaTime;
    video.requestVideoFrameCallback(tick);
  };
  video.requestVideoFrameCallback?.(tick);
  return () => frame;
}

/**
 * Video/audio viewer: the media element, a wavesurfer waveform with draggable ranges, keyboard
 * range marking and frame stepping, and (video) a thumbnail strip with scene-cut suggestions.
 * Comments anchor to `t=start,end` media fragments through the shared overlay panel.
 */
export const mountMediaViewer: ViewerMount = async (container, cfg) => {
  const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(cfg.source);
  const mediaUrl = fileUrl(cfg, cfg.source, true);
  const media = document.createElement(isVideo ? 'video' : 'audio');
  media.src = mediaUrl;
  media.preload = 'auto';
  media.className = 'ce-media-element';
  media.dataset.ce = 'media-element';
  if (media instanceof HTMLVideoElement) media.playsInline = true;

  const wrap = document.createElement('div');
  wrap.className = 'ce-media';
  const banner = document.createElement('div');
  banner.className = 'ce-media-banner';
  banner.dataset.ce = 'media-banner';
  banner.hidden = true;
  const waveEl = document.createElement('div');
  waveEl.className = 'ce-waveform';
  waveEl.dataset.ce = 'waveform';
  const bridge = createMediaContentAdapter();
  let strip: ThumbnailStrip | null = null;
  const frameDuration =
    media instanceof HTMLVideoElement ? trackFrameDuration(media) : () => AUDIO_STEP_SEC;

  const bar = createControlsBar({
    action: run,
    speed: (rate) => void (media.playbackRate = rate),
    scenes: () => void loadScenes(),
  });
  wrap.append(banner, media, bar.element, waveEl);
  container.replaceChildren(wrap);

  const size = await fileSize(mediaUrl);
  await new Promise<void>((resolve) => {
    if (media.readyState >= 1) return resolve();
    media.addEventListener('loadedmetadata', () => resolve(), { once: true });
    media.addEventListener('error', () => resolve(), { once: true });
  });
  if (media.error || !Number.isFinite(media.duration)) {
    banner.hidden = false;
    banner.textContent = `This browser cannot play ${cfg.source} (unsupported codec or container). Convert it to MP4/H.264 or WebM to comment.`;
  }
  const duration = Number.isFinite(media.duration) ? media.duration : 0;
  const selector = createWaveformRangeSelector({
    container: waveEl,
    media,
    url: mediaUrl,
    decode: size === null || size <= MAX_WAVEFORM_BYTES,
    duration,
  });

  let pendingIn: number | null = null;
  let loop = false;
  let selectedId: string | null = null;
  let ranges: RangeSpec[] = [];
  const selectedRange = () => ranges.find((r) => r.id === selectedId);

  function select(id: string | null, seek: boolean): void {
    selectedId = id;
    selector.select(id);
    const r = selectedRange();
    if (r && seek) media.currentTime = r.start;
  }

  function run(a: MediaAction): void {
    switch (a.type) {
      case 'toggle-play':
        void (media.paused ? media.play() : media.pause());
        break;
      case 'mark-in':
        pendingIn = media.currentTime;
        selector.setPendingIn(pendingIn);
        bar.setStatus(`In ${pendingIn.toFixed(3)}s — press ] to set the out-point`);
        break;
      case 'mark-out': {
        if (pendingIn === null) return bar.setStatus('Press [ first to mark the in-point');
        const [start, end] = [pendingIn, media.currentTime].sort((x, y) => x - y) as [
          number,
          number,
        ];
        pendingIn = null;
        selector.setPendingIn(null);
        bar.setStatus('');
        bridge.emitRange(start, end);
        break;
      }
      case 'point':
        bridge.emitRange(media.currentTime);
        break;
      case 'toggle-loop':
        loop = !loop;
        bar.setLoop(loop);
        if (loop && !selectedRange()) bar.setStatus('Select a range to loop it');
        break;
      case 'step-frame':
        media.pause();
        media.currentTime = Math.max(0, media.currentTime + a.direction * frameDuration());
        break;
      case 'seek':
        media.currentTime = Math.min(
          Math.max(0, media.currentTime + a.seconds),
          duration || Infinity,
        );
        break;
    }
  }

  async function loadScenes(): Promise<void> {
    bar.setStatus('Detecting scene cuts…');
    try {
      const res = await fetch(
        `/media/scenes?rootId=${cfg.rootId}&path=${encodeURIComponent(cfg.source)}`,
        {
          headers: { 'x-ce-token': cfg.token },
        },
      );
      const body = (await res.json()) as { cuts?: number[]; message?: string };
      if (!res.ok || !body.cuts) throw new Error(body.message ?? `Daemon responded ${res.status}`);
      selector.setSceneCuts(body.cuts);
      bar.setStatus(
        `${body.cuts.length} scene cut${body.cuts.length === 1 ? '' : 's'} marked in grey`,
      );
    } catch (err) {
      bar.setStatus(`Scene detection failed: ${(err as Error).message}`);
    }
  }

  selector.onDrag((start, end) => bridge.emitRange(start, end));
  selector.onRegionClick((id) => {
    select(id, true);
    bridge.emitPinClick(id);
    void media.play();
  });
  bridge.onPins((next) => {
    ranges = next;
    selector.setRanges(next);
    if (selectedId && !selectedRange()) selectedId = null;
  });
  bridge.onFocus((id) => select(id, true));

  media.addEventListener('timeupdate', () => {
    bar.setTime(media.currentTime, duration);
    const r = selectedRange();
    const end = r?.end;
    if (loop && r && end !== undefined && end > r.start && media.currentTime >= end) {
      media.currentTime = r.start;
    }
  });
  media.addEventListener('play', () => bar.setPlaying(true));
  media.addEventListener('pause', () => bar.setPlaying(false));
  bar.setTime(0, duration);

  const offKeys = bindMediaShortcuts(document, run);

  // Optional extras need ffmpeg on the daemon: show the install hint when it is missing.
  void (async () => {
    try {
      const res = await fetch('/media/capabilities', { headers: { 'x-ce-token': cfg.token } });
      const caps = (await res.json()) as { ffmpeg: boolean; warnings: string[] };
      if (!caps.ffmpeg) {
        banner.hidden = false;
        banner.textContent = caps.warnings[0] ?? 'ffmpeg is not installed.';
      } else if (isVideo) {
        bar.enableScenes(true);
        strip = createThumbnailStrip({
          url: `/media/thumbnails?rootId=${cfg.rootId}&path=${encodeURIComponent(cfg.source)}`,
          token: cfg.token,
          onSeek: (t) => void (media.currentTime = t),
        });
        wrap.insertBefore(strip.element, waveEl);
      }
    } catch {
      // Capability probing is best effort; the viewer works without it.
    }
  })();

  return {
    adapter: bridge.adapter,
    dispose() {
      offKeys();
      strip?.dispose();
      selector.destroy();
      media.pause();
      wrap.remove();
      bridge.adapter.dispose();
    },
  };
};
