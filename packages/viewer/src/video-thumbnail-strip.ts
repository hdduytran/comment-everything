export interface ThumbnailStrip {
  element: HTMLElement;
  dispose(): void;
}

/**
 * Horizontal strip of evenly spaced video thumbnails (one sprite image from the daemon).
 * Clicking a cell seeks to that time. Fails soft: any error leaves a short message instead.
 */
export function createThumbnailStrip(opts: {
  url: string;
  token: string;
  onSeek(time: number): void;
}): ThumbnailStrip {
  const element = document.createElement('div');
  element.className = 'ce-thumbs';
  element.dataset.ce = 'thumbs';
  let objectUrl: string | null = null;
  let disposed = false;

  const fail = (message: string) => {
    element.textContent = message;
    element.classList.add('ce-thumbs-note');
  };

  void (async () => {
    try {
      const res = await fetch(opts.url, { headers: { 'x-ce-token': opts.token } });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Daemon responded ${res.status}`);
      }
      const frames = Number(res.headers.get('x-ce-frames'));
      const duration = Number(res.headers.get('x-ce-duration'));
      const w = Number(res.headers.get('x-ce-thumb-width'));
      const h = Number(res.headers.get('x-ce-thumb-height'));
      if (![frames, duration, w, h].every((n) => Number.isFinite(n) && n > 0)) {
        throw new Error('Thumbnail response is malformed');
      }
      const blob = await res.blob();
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      const cells: HTMLElement[] = [];
      for (let i = 0; i < frames; i++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'ce-thumb';
        cell.style.cssText = `width:${w}px;height:${h}px;background:url(${objectUrl}) -${i * w}px 0 / ${frames * w}px ${h}px no-repeat`;
        const time = ((i + 0.5) * duration) / frames;
        cell.title = `${time.toFixed(1)}s`;
        cell.addEventListener('click', () => opts.onSeek(time));
        cells.push(cell);
      }
      element.replaceChildren(...cells);
    } catch (err) {
      if (!disposed) fail(`Thumbnails unavailable: ${(err as Error).message}`);
    }
  })();

  return {
    element,
    dispose() {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      element.remove();
    },
  };
}
