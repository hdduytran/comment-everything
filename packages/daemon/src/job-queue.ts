import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface Job<P = unknown, R = unknown> {
  id: string;
  type: string;
  status: JobStatus;
  payload: P;
  result?: R;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export type JobHandler<P = never, R = unknown> = (payload: P, job: Job) => Promise<R>;

const MAX_RETAINED_FINISHED = 200;

/**
 * Minimal in-memory job runner for slow media work (ffmpeg keyframes, whisper).
 * Handlers are registered per job type; jobs run FIFO with bounded concurrency.
 * Phase 4 registers its handlers via `register`; nothing media-specific lives here.
 */
export class JobQueue {
  private readonly handlers = new Map<string, JobHandler<never, unknown>>();
  private readonly jobs = new Map<string, Job>();
  private readonly waiting: string[] = [];
  private readonly events = new EventEmitter();
  private running = 0;

  constructor(private readonly concurrency = 2) {}

  register<P, R>(type: string, handler: JobHandler<P, R>): void {
    if (this.handlers.has(type)) throw new Error(`Job type already registered: ${type}`);
    this.handlers.set(type, handler as JobHandler<never, unknown>);
  }

  /** Queue a job; throws synchronously for unknown job types. */
  enqueue<P>(type: string, payload: P): Job<P> {
    if (!this.handlers.has(type)) throw new Error(`Unknown job type: ${type}`);
    const job: Job<P> = {
      id: randomUUID(),
      type,
      status: 'queued',
      payload,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    this.waiting.push(job.id);
    this.pump();
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  list(): Job[] {
    return [...this.jobs.values()];
  }

  /** Resolve once the job reaches a terminal state. */
  waitFor(id: string): Promise<Job> {
    const job = this.jobs.get(id);
    if (!job) return Promise.reject(new Error(`Unknown job: ${id}`));
    if (job.status === 'succeeded' || job.status === 'failed') return Promise.resolve(job);
    return new Promise((resolve) => {
      const onDone = (done: Job) => {
        if (done.id !== id) return;
        this.events.off('done', onDone);
        resolve(done);
      };
      this.events.on('done', onDone);
    });
  }

  private pump(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const id = this.waiting.shift() as string;
      const job = this.jobs.get(id);
      const handler = job && this.handlers.get(job.type);
      if (!job || !handler) continue;
      this.running++;
      job.status = 'running';
      handler(job.payload as never, job)
        .then((result) => {
          job.result = result;
          job.status = 'succeeded';
        })
        .catch((err: unknown) => {
          job.error = err instanceof Error ? err.message : String(err);
          job.status = 'failed';
        })
        .finally(() => {
          job.finishedAt = new Date().toISOString();
          this.running--;
          this.events.emit('done', job);
          this.evictFinished();
          this.pump();
        });
    }
  }

  /** Keep memory bounded: drop the oldest finished jobs beyond the retention limit. */
  private evictFinished(): void {
    const finished = [...this.jobs.values()].filter((j) => j.finishedAt);
    for (const j of finished.slice(0, Math.max(0, finished.length - MAX_RETAINED_FINISHED))) {
      this.jobs.delete(j.id);
    }
  }
}
