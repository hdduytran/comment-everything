import type { Context, Hono } from 'hono';
import { CommentPatchSchema, CommentStatusSchema } from '@comment-everything/core';
import { z } from 'zod';
import { CreateBatchBodySchema, ValidationError, type CommentService } from './comment-service.js';
import type { JobQueue } from './job-queue.js';
import { ProjectRootRegistry, RootRegistryError } from './project-root-registry.js';

/** Parse a JSON body, turning malformed JSON into a 400 instead of a 500. */
async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

const ListQuerySchema = z.object({
  source: z.string().optional(),
  status: CommentStatusSchema.optional(),
  root: z.string().optional(),
});

const WAIT_MAX_SEC = 600;

export interface RestDeps {
  service: CommentService;
  registry: ProjectRootRegistry;
  jobs: JobQueue;
}

/** Mount the JSON REST API (comments, batches, roots, jobs). */
export function mountRestRoutes(app: Hono, { service, registry, jobs }: RestDeps): void {
  app.post('/comments', async (c) => {
    const body = CreateBatchBodySchema.parse(await readJson(c));
    const batch = await service.createBatch(body);
    return c.json(batch, 201);
  });

  app.get('/comments', async (c) => {
    const q = ListQuerySchema.parse(c.req.query());
    return c.json({ comments: await service.list(q) });
  });

  app.get('/comments/:id', async (c) => {
    const comment = await service.get(c.req.param('id'));
    return comment ? c.json(comment) : c.json({ error: 'not_found' }, 404);
  });

  app.patch('/comments/:id', async (c) => {
    const patch = CommentPatchSchema.parse(await readJson(c));
    const updated = await service.update(c.req.param('id'), patch);
    return updated ? c.json(updated) : c.json({ error: 'not_found' }, 404);
  });

  /** Raw bytes of an asset listed on the comment (`?path=assets/<file>`). */
  app.get('/comments/:id/asset', async (c) => {
    const blob = await service.readAsset(c.req.param('id'), c.req.query('path') ?? '');
    if (!blob) return c.json({ error: 'not_found' }, 404);
    return new Response(blob.data, {
      headers: { 'Content-Type': blob.mimeType, 'X-Content-Type-Options': 'nosniff' },
    });
  });

  /** Long-poll for the next Send batch: 200 with the batch, or 204 on timeout. */
  app.get('/batches/next', async (c) => {
    const sec = Math.min(WAIT_MAX_SEC, Math.max(1, Number(c.req.query('timeoutSec') ?? 30) || 30));
    const batch = await service.waitForBatch(sec, c.req.raw.signal);
    return batch ? c.json(batch) : c.body(null, 204);
  });

  app.get('/roots', (c) => c.json({ roots: registry.list() }));

  app.post('/roots', async (c) => {
    const { root } = z.object({ root: z.string().min(1) }).parse(await readJson(c));
    try {
      return c.json(await registry.register(root), 201);
    } catch (err) {
      if (err instanceof RootRegistryError) throw new ValidationError(err.message);
      throw err;
    }
  });

  app.get('/jobs', (c) => c.json({ jobs: jobs.list() }));

  app.get('/jobs/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    return job ? c.json(job) : c.json({ error: 'not_found' }, 404);
  });
}
