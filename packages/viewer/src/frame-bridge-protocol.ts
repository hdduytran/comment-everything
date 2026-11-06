import { SelectorSchema } from '@comment-everything/core/browser';
import { z } from 'zod';

/**
 * postMessage protocol between the viewer page and the frame agent running inside the sandboxed
 * HTML iframe. Neither side trusts the other: every message is shape-validated, and the viewer
 * additionally requires `event.source === iframe.contentWindow`. The token is never sent.
 */
export const BRIDGE_TAG = 'ce-bridge-v1';

/** Screenshots above this size are dropped (the daemon enforces its own 10 MB cap too). */
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

const ModeSchema = z.enum(['element', 'text', 'region']).nullable();
const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
const SelectorsSchema = z.array(SelectorSchema).max(20);
const tagged = { tag: z.literal(BRIDGE_TAG) };

/** Viewer -> frame agent. */
export const ParentMessageSchema = z.discriminatedUnion('kind', [
  z.object({ ...tagged, kind: z.literal('set-mode'), mode: ModeSchema }),
  z.object({
    ...tagged,
    kind: z.literal('set-pins'),
    pins: z
      .array(
        z.object({
          id: z.string().max(100),
          n: z.number().int().positive(),
          selectors: SelectorsSchema,
        }),
      )
      .max(500),
  }),
  z.object({ ...tagged, kind: z.literal('focus-pin'), id: z.string().max(100) }),
  z.object({ ...tagged, kind: z.literal('refresh') }),
]);
export type ParentMessage = z.infer<typeof ParentMessageSchema>;

/** Frame agent -> viewer. */
export const FrameMessageSchema = z.discriminatedUnion('kind', [
  z.object({ ...tagged, kind: z.literal('ready') }),
  z.object({
    ...tagged,
    kind: z.literal('anchor'),
    selectors: SelectorsSchema,
    label: z.string().max(300),
    screenshot: z
      .object({
        rect: RectSchema,
        png: z
          .instanceof(Blob)
          .refine((b) => b.size > 0 && b.size <= MAX_SCREENSHOT_BYTES, 'bad screenshot size'),
      })
      .optional(),
  }),
  z.object({ ...tagged, kind: z.literal('pin-click'), id: z.string().max(100) }),
  z.object({ ...tagged, kind: z.literal('cancel') }),
]);
export type FrameMessage = z.infer<typeof FrameMessageSchema>;

/** Message payloads without the protocol tag (added by the senders). */
export type Untagged<T> = T extends unknown ? Omit<T, 'tag'> : never;

export function parseParentMessage(data: unknown): ParentMessage | null {
  const r = ParentMessageSchema.safeParse(data);
  return r.success ? r.data : null;
}

export function parseFrameMessage(data: unknown): FrameMessage | null {
  const r = FrameMessageSchema.safeParse(data);
  return r.success ? r.data : null;
}
