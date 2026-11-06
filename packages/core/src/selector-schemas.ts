import { z } from 'zod';

/**
 * Selector schemas. The first four follow the W3C Web Annotation data model;
 * LineRange and Screenshot are custom extensions (discriminated by `type`).
 */

/** Quote with optional surrounding context, used to re-anchor text after edits. */
export const TextQuoteSelectorSchema = z.object({
  type: z.literal('TextQuoteSelector'),
  exact: z.string(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
});

/** Character offsets into the normalized text content of the source. */
export const TextPositionSelectorSchema = z.object({
  type: z.literal('TextPositionSelector'),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export const CssSelectorSchema = z.object({
  type: z.literal('CssSelector'),
  value: z.string().min(1),
});

export const XPathSelectorSchema = z.object({
  type: z.literal('XPathSelector'),
  value: z.string().min(1),
});

/** Custom: 1-based inclusive line range, for Markdown and source files. */
export const LineRangeSelectorSchema = z
  .object({
    type: z.literal('LineRangeSelector'),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((s) => s.endLine >= s.startLine, { message: 'endLine must be >= startLine' });

export const MEDIA_FRAGMENT_SPEC = 'http://www.w3.org/TR/media-frags/';

/** W3C media fragment, e.g. `t=12.5,48` (seconds). The end time is optional. */
export const FragmentSelectorSchema = z.object({
  type: z.literal('FragmentSelector'),
  conformsTo: z.literal(MEDIA_FRAGMENT_SPEC).default(MEDIA_FRAGMENT_SPEC),
  value: z
    .string()
    .regex(/^t=\d+(\.\d+)?(,\d+(\.\d+)?)?$/, 'expected media fragment t=start[,end]'),
});

/** Custom: a rectangular region captured as an image asset. */
export const ScreenshotSelectorSchema = z.object({
  type: z.literal('ScreenshotSelector'),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  }),
  /** Asset path relative to the `.comments/` directory, e.g. `assets/abc.png`. */
  asset: z.string().min(1),
});

export const SelectorSchema = z.discriminatedUnion('type', [
  TextQuoteSelectorSchema,
  TextPositionSelectorSchema,
  CssSelectorSchema,
  XPathSelectorSchema,
  LineRangeSelectorSchema,
  FragmentSelectorSchema,
  ScreenshotSelectorSchema,
]);

export type Selector = z.infer<typeof SelectorSchema>;
export type TextQuoteSelector = z.infer<typeof TextQuoteSelectorSchema>;
export type LineRangeSelector = z.infer<typeof LineRangeSelectorSchema>;
export type FragmentSelector = z.infer<typeof FragmentSelectorSchema>;
export type ScreenshotSelector = z.infer<typeof ScreenshotSelectorSchema>;

/** Build a media-fragment selector from a time range in seconds. */
export function mediaFragmentSelector(startSec: number, endSec?: number): FragmentSelector {
  const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
  const value = endSec === undefined ? `t=${fmt(startSec)}` : `t=${fmt(startSec)},${fmt(endSec)}`;
  return FragmentSelectorSchema.parse({ type: 'FragmentSelector', value });
}

/** Parse `t=start[,end]` into seconds, or null when the selector is not a time fragment. */
export function parseMediaFragment(sel: FragmentSelector): { start: number; end?: number } | null {
  const m = /^t=(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?$/.exec(sel.value);
  if (!m) return null;
  return m[2] === undefined ? { start: Number(m[1]) } : { start: Number(m[1]), end: Number(m[2]) };
}
