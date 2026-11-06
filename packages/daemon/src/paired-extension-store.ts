import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { globalDataDir, writeFileAtomic } from '@comment-everything/core';
import { resolveHome } from './daemon-lockfile.js';

/** Chrome extension ids are 32 chars from a-p. Anything else is never stored or trusted. */
const EXTENSION_ID = /^[a-p]{32}$/;

export const isExtensionId = (value: string): boolean => EXTENSION_ID.test(value);

/**
 * Chrome extensions the user explicitly paired with this daemon. Only their
 * `chrome-extension://<id>` origins pass the origin guard. Persisted next to the token so
 * pairing survives daemon restarts.
 */
export class PairedExtensionStore {
  private readonly ids = new Set<string>();
  private readonly file: string;

  constructor(home?: string) {
    this.file = path.join(globalDataDir(resolveHome(home)), 'paired-extensions.json');
  }

  async load(): Promise<void> {
    try {
      const saved: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (Array.isArray(saved)) {
        for (const id of saved) if (typeof id === 'string' && isExtensionId(id)) this.ids.add(id);
      }
    } catch {
      // first run or unreadable file: nothing is paired
    }
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  list(): string[] {
    return [...this.ids];
  }

  async add(id: string): Promise<void> {
    if (!isExtensionId(id)) throw new Error('Invalid extension id');
    this.ids.add(id);
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFileAtomic(this.file, JSON.stringify(this.list(), null, 2) + '\n');
  }
}
