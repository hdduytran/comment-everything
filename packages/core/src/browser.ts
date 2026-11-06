/**
 * Browser-safe subset of the core package (no Node built-ins, no file watching).
 * Used by the overlay, viewer and Chrome extension bundles.
 */
import { z } from 'zod';

// Content-Security-Policy on viewer pages forbids `eval`; zod's JIT fast path needs it.
z.config({ jitless: true });

export * from './selector-schemas.js';
export * from './prompt-formatter.js';
export type {
  Comment,
  CommentInput,
  CommentPatch,
  CommentStatus,
  Transcript,
} from './comment-schema.js';
