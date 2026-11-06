import type { Hono } from 'hono';
import { ValidationError, type CommentService } from './comment-service.js';

export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

/** Detect the image type from magic bytes; the client-declared Content-Type is not trusted. */
export function sniffImage(data: Uint8Array): { ext: string; mime: string } | null {
  const at = (i: number) => data[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  const ascii = (from: number, to: number) => String.fromCharCode(...data.subarray(from, to));
  if (data.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

/**
 * `POST /comments/assets?root=<project root>` or `?source=<http(s) url>`: store a screenshot
 * taken in the viewer/extension before Send, so the comment can reference it by relative path.
 * Body is the raw image (png, jpeg or webp, at most 10 MB). Responds `{ asset: "assets/<name>" }`.
 */
export function mountAssetUploadRoute(app: Hono, service: CommentService): void {
  app.post('/comments/assets', async (c) => {
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > MAX_ASSET_BYTES) throw new ValidationError('Asset exceeds the 10 MB limit');
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.length === 0 || data.length > MAX_ASSET_BYTES) {
      throw new ValidationError('Asset must be between 1 byte and 10 MB');
    }
    const image = sniffImage(data);
    if (!image) throw new ValidationError('Asset must be a png, jpeg or webp image');
    const asset = await service.saveAsset(
      { root: c.req.query('root'), source: c.req.query('source') },
      data,
      image.ext,
    );
    return c.json({ asset }, 201);
  });
}
