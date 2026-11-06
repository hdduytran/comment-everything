import { describe, expect, it } from 'vitest';
import { CommentEventBus, WATCH_GRACE_MS, type SentBatch } from '../src/comment-events-sse.js';

function batch(id: string): SentBatch {
  return { batchId: id, comments: [] };
}

/** Bus with a controllable clock. */
function makeBus() {
  let t = 1_000_000;
  const bus = new CommentEventBus(() => t);
  return { bus, advance: (ms: number) => (t += ms) };
}

describe('batch queue only serves agents that are watching', () => {
  it('does not hand a watcher batches sent while nobody was watching', async () => {
    const { bus } = makeBus();
    bus.sendBatch(batch('stale-1'));
    bus.sendBatch(batch('stale-2'));
    expect(await bus.nextBatch(10)).toBeNull();
  });

  it('delivers a batch sent while an agent is waiting', async () => {
    const { bus } = makeBus();
    const waiting = bus.nextBatch(1_000);
    bus.sendBatch(batch('live'));
    expect((await waiting)?.batchId).toBe('live');
  });

  it('keeps a batch sent while the watcher is busy between two waits', async () => {
    const { bus, advance } = makeBus();
    expect(await bus.nextBatch(1)).toBeNull(); // agent waited, timed out, is now working
    advance(WATCH_GRACE_MS - 1_000);
    bus.sendBatch(batch('during-work'));
    expect((await bus.nextBatch(10))?.batchId).toBe('during-work');
  });

  it('drops batches once the watcher has been gone longer than the grace period', async () => {
    const { bus, advance } = makeBus();
    expect(await bus.nextBatch(1)).toBeNull();
    advance(WATCH_GRACE_MS - 1_000);
    bus.sendBatch(batch('queued'));
    advance(WATCH_GRACE_MS + 1_000); // watcher stopped long ago
    expect(await bus.nextBatch(10)).toBeNull();
  });

  it('still publishes batch.sent to SSE listeners when nobody is watching', () => {
    const { bus } = makeBus();
    const seen: string[] = [];
    bus.subscribe((e) => {
      if (e.type === 'batch.sent') seen.push(e.batchId);
    });
    bus.sendBatch(batch('unwatched'));
    expect(seen).toEqual(['unwatched']);
  });
});
