// Packs the built extension folder into release/comment-everything-extension-<version>.zip for the
// Chrome Web Store dashboard. Dependency-free: a minimal deterministic ZIP writer (deflate).
// Run `pnpm --filter @comment-everything/extension zip` (builds first).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const buildDir = path.join(root, 'dist');
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));

execFileSync(process.execPath, [path.join(import.meta.dirname, 'build-extension.mjs')], {
  stdio: 'inherit',
});

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Every file under `dir`, as forward-slash paths relative to it, sorted for stable output. */
function listFiles(dir, prefix = '') {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      return statSync(full).isDirectory() ? listFiles(full, rel) : [rel];
    });
}

// Fixed DOS timestamp (2020-01-01) keeps the archive byte-identical across runs.
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

const parts = [];
const central = [];
let offset = 0;
for (const rel of listFiles(buildDir)) {
  const data = readFileSync(path.join(buildDir, rel));
  const packed = deflateRawSync(data, { level: 9 });
  const name = Buffer.from(rel);
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  parts.push(local, name, packed);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4); // version made by
  entry.writeUInt16LE(20, 6); // version needed
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(DOS_TIME, 12);
  entry.writeUInt16LE(DOS_DATE, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += local.length + name.length + packed.length;
}

const centralSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const releaseDir = path.join(root, 'release');
mkdirSync(releaseDir, { recursive: true });
const out = path.join(releaseDir, `comment-everything-extension-${manifest.version}.zip`);
writeFileSync(out, Buffer.concat([...parts, ...central, end]));
console.log(`Wrote ${out} (${central.length / 2} files)`);
