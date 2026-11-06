// One-off generator for the toolbar/store icons (a white speech bubble on a blue rounded square).
// Run `node scripts/make-icons.mjs`; the PNGs in icons/ are committed.
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const out = path.resolve(import.meta.dirname, '..', 'icons');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

function pixel(u, v) {
  // u, v in [0,1]. Returns RGBA.
  if (!inRoundRect(u, v, 0, 0, 1, 1, 0.22)) return [0, 0, 0, 0];
  const bubble = inRoundRect(u, v, 0.2, 0.24, 0.8, 0.62, 0.1);
  const tail = v >= 0.6 && v <= 0.78 && u >= 0.28 && u <= 0.28 + (0.78 - v) * 0.9;
  return bubble || tail ? [255, 255, 255, 255] : [37, 99, 235, 255];
}

function png(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      // 3x3 supersampling for smooth edges.
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const p = pixel((x + (sx + 0.5) / 3) / size, (y + (sy + 0.5) / 3) / size);
          for (let i = 0; i < 4; i++) acc[i] += p[i] / 9;
        }
      }
      row.push(...acc.map(Math.round));
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 48, 128]) writeFileSync(path.join(out, `icon-${size}.png`), png(size));
