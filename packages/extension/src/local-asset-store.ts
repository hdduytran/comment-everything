import { base64ToBytes, bytesToBase64 } from './base64-bytes.js';
import { askWorker } from './content-proxy-transport.js';
import type { AssetGetReply, AssetPutReply } from './extension-messages.js';

/** Screenshots saved in this browser. Paths look like `assets/<id>.png`, as in a project's `.comments/`. */
export interface AssetStore {
  put(image: Blob): Promise<string>;
  get(path: string): Promise<Blob | null>;
  delete(path: string): Promise<void>;
}

export const ASSET_PATH = /^assets\/[A-Za-z0-9_-]{1,64}\.png$/;
/** Same cap as the daemon's upload route. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Reject anything that is not a PNG within the size cap (the only thing region capture produces). */
export async function assertPng(image: Blob): Promise<void> {
  if (image.size === 0 || image.size > MAX_ASSET_BYTES) {
    throw new Error(`Screenshot must be between 1 byte and ${MAX_ASSET_BYTES / 1024 / 1024} MB`);
  }
  const head = new Uint8Array(await image.slice(0, PNG_MAGIC.length).arrayBuffer());
  if (!PNG_MAGIC.every((b, i) => head[i] === b)) throw new Error('Screenshot is not a PNG image');
}

export function assertAssetPath(path: string): void {
  if (!ASSET_PATH.test(path)) throw new Error(`Invalid asset path: ${path}`);
}

const newAssetPath = () => `assets/${globalThis.crypto.randomUUID()}.png`;

/** In-memory store for unit tests. */
export function memoryAssetStore(): AssetStore & { size(): number } {
  const blobs = new Map<string, Blob>();
  return {
    async put(image) {
      await assertPng(image);
      const path = newAssetPath();
      blobs.set(path, image);
      return path;
    },
    async get(path) {
      assertAssetPath(path);
      return blobs.get(path) ?? null;
    },
    async delete(path) {
      blobs.delete(path);
    },
    size: () => blobs.size,
  };
}

const DB_NAME = 'comment-everything';
const STORE = 'assets';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Blobs in IndexedDB. Must run in an extension context (the service worker): IndexedDB opened
 * from a content script would belong to the web page's origin, not the extension's.
 */
export function createIndexedDbAssetStore(factory: IDBFactory = indexedDB): AssetStore {
  let opened: Promise<IDBDatabase> | undefined;
  const open = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Cannot open IndexedDB'));
    }));
  const tx = async (mode: IDBTransactionMode) =>
    (await open()).transaction(STORE, mode).objectStore(STORE);

  return {
    async put(image) {
      await assertPng(image);
      const path = newAssetPath();
      await request((await tx('readwrite')).put(image, path));
      return path;
    },
    async get(path) {
      assertAssetPath(path);
      const found = await request((await tx('readonly')).get(path));
      return found instanceof Blob ? found : null;
    },
    async delete(path) {
      assertAssetPath(path);
      await request((await tx('readwrite')).delete(path));
    },
  };
}

/** The content script's view of the store: every call goes through the service worker. */
export function createWorkerAssetStore(): AssetStore {
  return {
    async put(image) {
      await assertPng(image);
      const reply = await askWorker<AssetPutReply>({
        type: 'ce:asset-put',
        body: bytesToBase64(new Uint8Array(await image.arrayBuffer())),
      });
      if (!reply.ok) throw new Error(reply.error);
      return reply.path;
    },
    async get(path) {
      const reply = await askWorker<AssetGetReply>({ type: 'ce:asset-get', path });
      if (!reply.ok) throw new Error(reply.error);
      return reply.body === null
        ? null
        : new Blob([base64ToBytes(reply.body)], { type: 'image/png' });
    },
    async delete(path) {
      await askWorker({ type: 'ce:asset-delete', path });
    },
  };
}
