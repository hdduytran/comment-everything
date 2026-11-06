import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region, type RegionParams } from 'wavesurfer.js/plugins/regions';
import TimelinePlugin from 'wavesurfer.js/plugins/timeline';

/** A comment range drawn on the waveform. `end` is absent for a point comment. */
export interface RangeSpec {
  id: string;
  n: number;
  start: number;
  end?: number;
}

export interface WaveformRangeSelector {
  /** The user finished dragging a new range on the waveform. */
  onDrag(cb: (start: number, end: number) => void): void;
  onRegionClick(cb: (id: string) => void): void;
  /** Replace all comment ranges (the pending-comment list is the source of truth). */
  setRanges(ranges: RangeSpec[]): void;
  /** Highlight one range (or none). */
  select(id: string | null): void;
  /** Show or clear the pending in-point marker set with `[`. */
  setPendingIn(time: number | null): void;
  /** Draw scene-cut suggestions as thin grey markers. */
  setSceneCuts(times: number[]): void;
  destroy(): void;
}

const COLORS = {
  range: 'rgba(37, 99, 235, 0.28)',
  selected: 'rgba(245, 158, 11, 0.4)',
  pending: 'rgba(16, 185, 129, 0.9)',
  scene: 'rgba(107, 114, 128, 0.9)',
};

/** Files above this size are not decoded for a waveform (it would exhaust browser memory). */
export const MAX_WAVEFORM_BYTES = 150 * 1024 * 1024;

export interface WaveformOptions {
  container: HTMLElement;
  media: HTMLMediaElement;
  url: string;
  /** Decode the file for a real waveform; otherwise only the timeline and ranges are drawn. */
  decode: boolean;
  duration: number;
}

/** Wavesurfer bound to an existing `<video>`/`<audio>` element, with a regions layer on top. */
export function createWaveformRangeSelector(opts: WaveformOptions): WaveformRangeSelector {
  const regions = RegionsPlugin.create();
  const ws = WaveSurfer.create({
    container: opts.container,
    media: opts.media,
    url: opts.url,
    ...(opts.decode ? {} : { peaks: [new Float32Array(2048)], duration: opts.duration }),
    height: 88,
    waveColor: '#94a3b8',
    progressColor: '#2563eb',
    cursorColor: '#ef4444',
    plugins: [regions, TimelinePlugin.create()],
  });

  const ours = new Map<string, Region>();
  let pendingMarker: Region | null = null;
  let sceneMarkers: Region[] = [];
  let selected: string | null = null;
  let programmatic = false;
  const dragListeners: ((s: number, e: number) => void)[] = [];
  const clickListeners: ((id: string) => void)[] = [];

  const add = (options: RegionParams): Region => {
    programmatic = true;
    try {
      return regions.addRegion(options);
    } finally {
      programmatic = false;
    }
  };

  regions.enableDragSelection({ color: COLORS.range });
  regions.on('region-created', (region) => {
    if (programmatic) return;
    const { start, end } = region;
    // The drawn region is only a gesture; the pending-comment list re-creates it with its number.
    queueMicrotask(() => region.remove());
    dragListeners.forEach((cb) => cb(start, end));
  });
  regions.on('region-clicked', (region, ev) => {
    const entry = [...ours].find(([, r]) => r === region);
    if (!entry) return;
    ev.stopPropagation();
    clickListeners.forEach((cb) => cb(entry[0]));
  });

  const paint = () => {
    for (const [id, r] of ours) {
      r.setOptions({ color: id === selected ? COLORS.selected : COLORS.range });
    }
  };

  return {
    onDrag: (cb) => void dragListeners.push(cb),
    onRegionClick: (cb) => void clickListeners.push(cb),
    setRanges(ranges) {
      for (const r of ours.values()) r.remove();
      ours.clear();
      for (const r of ranges) {
        const isPoint = r.end === undefined || r.end <= r.start;
        const region = add({
          start: r.start,
          ...(isPoint ? {} : { end: r.end }),
          content: String(r.n),
          color: r.id === selected ? COLORS.selected : COLORS.range,
          drag: false,
          resize: false,
        });
        ours.set(r.id, region);
      }
    },
    select(id) {
      selected = id;
      paint();
    },
    setPendingIn(time) {
      pendingMarker?.remove();
      pendingMarker =
        time === null ? null : add({ start: time, color: COLORS.pending, drag: false });
    },
    setSceneCuts(times) {
      sceneMarkers.forEach((m) => m.remove());
      sceneMarkers = times.map((t) => add({ start: t, color: COLORS.scene, drag: false }));
    },
    destroy: () => ws.destroy(),
  };
}
