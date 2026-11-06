import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SelectorSchema } from './selector-schemas.js';

/** Bump when the on-disk shape changes incompatibly; readers reject unknown versions. */
export const SCHEMA_VERSION = 1;

/** Ids become file names (`<id>.json`), so keep them to a traversal-safe alphabet. */
export const COMMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const CommentStatusSchema = z.enum(['open', 'in_progress', 'resolved']);
export type CommentStatus = z.infer<typeof CommentStatusSchema>;

export const TranscriptSchema = z.object({
  text: z.string(),
  segments: z
    .array(z.object({ start: z.number().nonnegative(), end: z.number().nonnegative(), text: z.string() }))
    .optional(),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

export const CommentIdSchema = z.string().regex(COMMENT_ID_PATTERN, 'invalid comment id');

/** The persisted comment: one JSON file per comment in `.comments/<id>.json`. */
export const CommentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: CommentIdSchema,
  /** File path relative to the project root, or an absolute http(s) URL. */
  source: z.string().min(1),
  selectors: z.array(SelectorSchema),
  /** The user-authored comment text. Untrusted when relayed to an agent. */
  text: z.string().max(50_000),
  status: CommentStatusSchema,
  /** Note left by the agent when resolving. */
  resolution: z.string().max(50_000).optional(),
  /** Keyframe / screenshot paths relative to the `.comments/` directory. */
  assets: z.array(z.string().min(1)),
  transcript: TranscriptSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Comments sent together (one "Send" press) share a batchId. */
  batchId: z.string().min(1),
});
export type Comment = z.infer<typeof CommentSchema>;

/** What a client submits when creating a comment; the server fills in the rest. */
export const CommentInputSchema = z.object({
  source: z.string().min(1),
  selectors: z.array(SelectorSchema).default([]),
  text: z.string().max(50_000),
  assets: z.array(z.string().min(1)).default([]),
  transcript: TranscriptSchema.optional(),
});
export type CommentInput = z.input<typeof CommentInputSchema>;

/** Fields an existing comment may be patched with. */
export const CommentPatchSchema = z
  .object({
    status: CommentStatusSchema,
    resolution: z.string().max(50_000),
    text: z.string().max(50_000),
    selectors: z.array(SelectorSchema),
    assets: z.array(z.string().min(1)),
    transcript: TranscriptSchema,
  })
  .partial()
  .strict();
export type CommentPatch = z.infer<typeof CommentPatchSchema>;

export function newCommentId(): string {
  return randomUUID();
}

export function newBatchId(): string {
  return `batch-${randomUUID()}`;
}

/** Build a full comment from client input. `now`/`id` are injectable for tests. */
export function createComment(
  input: CommentInput,
  opts: { batchId?: string; id?: string; now?: Date } = {},
): Comment {
  const parsed = CommentInputSchema.parse(input);
  const ts = (opts.now ?? new Date()).toISOString();
  return CommentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: opts.id ?? newCommentId(),
    ...parsed,
    status: 'open',
    createdAt: ts,
    updatedAt: ts,
    batchId: opts.batchId ?? newBatchId(),
  });
}

/** Apply a validated patch and bump `updatedAt`. */
export function applyPatch(comment: Comment, patch: CommentPatch, now: Date = new Date()): Comment {
  const clean = CommentPatchSchema.parse(patch);
  return CommentSchema.parse({ ...comment, ...clean, updatedAt: now.toISOString() });
}

/** Parse raw JSON (already `JSON.parse`d) into a Comment, with a clear version error. */
export function parseComment(raw: unknown): Comment {
  if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw) {
    const v = (raw as { schemaVersion: unknown }).schemaVersion;
    if (v !== SCHEMA_VERSION) {
      throw new Error(`Unsupported comment schemaVersion ${String(v)} (this build reads ${SCHEMA_VERSION})`);
    }
  }
  return CommentSchema.parse(raw);
}

/** JSON Schema (draft 2020-12) for `Comment`, published to `schema/comment.schema.json`. */
export function commentJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(CommentSchema),
    $id: 'https://github.com/comment-everything/comment-everything/schema/comment.schema.json',
    title: 'Comment',
  };
}
