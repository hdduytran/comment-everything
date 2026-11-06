# Comment schema reference

Every comment is one JSON file: `<project>/.comments/<id>.json`. Comments on web pages that are not mapped to a project live in `~/.comment-everything/<host>/.comments/` (the host is sanitised, for example `localhost_3000`). Screenshots and keyframes sit beside them in `assets/`.

The authoritative definition is the Zod schema in [`packages/core/src/comment-schema.ts`](../packages/core/src/comment-schema.ts) and [`selector-schemas.ts`](../packages/core/src/selector-schemas.ts). The machine-readable JSON Schema (draft 2020-12) is generated from it on every build:

- [`packages/core/schema/comment.schema.json`](../packages/core/schema/comment.schema.json)
- Importable as `@comment-everything/core/schema/comment.schema.json` inside the monorepo.

Readers reject files whose `schemaVersion` they do not understand (currently `1`).

## Example

```json
{
  "schemaVersion": 1,
  "id": "6f0c1f2e-4f0e-4b57-9a1e-3f9d7a2b8c11",
  "source": "page.html",
  "selectors": [
    { "type": "CssSelector", "value": "#cta" },
    { "type": "XPathSelector", "value": "//*[@id=\"cta\"]" },
    { "type": "TextQuoteSelector", "exact": "Get started", "prefix": "busywork.", "suffix": "" }
  ],
  "text": "Say \"Start free\" instead",
  "status": "open",
  "assets": [],
  "anchorState": "ok",
  "createdAt": "2026-11-06T07:12:03.120Z",
  "updatedAt": "2026-11-06T07:12:03.120Z",
  "batchId": "batch-2d1b0b9e-5e8d-4c1c-8d0e-0e2f3b3a9d77"
}
```

## Comment fields

| Field                    | Type                                   | Notes                                                                                                                                    |
| ------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`          | `1`                                    | Required. Bumped on incompatible changes.                                                                                                |
| `id`                     | string                                 | Required. `^[A-Za-z0-9_-]{1,64}$` (it becomes the file name). Defaults to a UUID.                                                        |
| `source`                 | string                                 | Required. File path relative to the project root (forward slashes, never absolute or containing `..`), or an absolute `http(s)` URL.     |
| `selectors`              | array of selector                      | Required, may be empty. Several selectors describe the same target in different ways so it can be re-found later.                        |
| `text`                   | string                                 | Required, at most 50 000 characters. The reviewer's words. **Untrusted** when relayed to an agent.                                       |
| `status`                 | `open` \| `in_progress` \| `resolved`  | Required. New comments are `open`.                                                                                                       |
| `resolution`             | string                                 | Optional. Note left by the agent when resolving.                                                                                         |
| `assets`                 | string[]                               | Required. Paths relative to the `.comments/` directory, for example `assets/<name>.jpg`. Keyframes (media) and screenshots (regions).    |
| `transcript`             | `{ text, segments? }`                  | Optional. Whisper transcript of the commented time range. Each segment is `{ start, end, text }` in seconds.                             |
| `anchorState`            | `ok` \| `moved` \| `orphaned`          | Optional. Result of re-anchoring after the source changed. Absent means never re-checked.                                                |
| `lastResolved`           | `{ start, end, startLine?, endLine? }` | Optional. Last span found by the re-anchoring engine (character offsets in the source's searchable text, plus 1-based lines when known). |
| `createdAt`, `updatedAt` | ISO 8601 datetime                      | Required.                                                                                                                                |
| `batchId`                | string                                 | Required. Comments sent with one press of **Send** share it.                                                                             |

Files are written atomically. Editing a file by hand is fine; the daemon watches `.comments/` and picks changes up.

## Selectors

Selectors are discriminated by `type`. The first four are W3C Web Annotation selectors; the rest are extensions.

### `TextQuoteSelector` (W3C)

```json
{ "type": "TextQuoteSelector", "exact": "Buy now", "prefix": "Card: ", "suffix": " today" }
```

The quoted text plus optional surrounding context. This is the most durable anchor: re-anchoring searches for it with fuzzy matching when the file has changed.

### `TextPositionSelector` (W3C)

```json
{ "type": "TextPositionSelector", "start": 120, "end": 134 }
```

Character offsets into the normalised text content of the source. Only trusted by the re-anchoring engine when the comment has no quote to verify against.

### `CssSelector` (W3C)

```json
{ "type": "CssSelector", "value": "main > ul > li:nth-child(2)" }
```

Generated for element picks in HTML and Markdown. Uses an `#id` when the element has one, otherwise a path of `tag` / `tag:nth-of-type(n)` segments.

### `XPathSelector` (W3C)

```json
{ "type": "XPathSelector", "value": "//*[@id=\"title\"]" }
```

Same target as the CSS selector, as an XPath.

### `LineRangeSelector` (extension)

```json
{ "type": "LineRangeSelector", "startLine": 3, "endLine": 4 }
```

1-based inclusive line range in the source file. Used for Markdown and other text sources. `endLine` must be greater than or equal to `startLine`.

### `FragmentSelector` (W3C media fragment)

```json
{
  "type": "FragmentSelector",
  "conformsTo": "http://www.w3.org/TR/media-frags/",
  "value": "t=12.5,48"
}
```

Time in seconds: `t=<start>` for a point, `t=<start>,<end>` for a range. Used for video and audio. Helpers `mediaFragmentSelector` and `parseMediaFragment` are exported from `@comment-everything/core`.

### `ScreenshotSelector` (extension)

```json
{
  "type": "ScreenshotSelector",
  "rect": { "x": 40, "y": 120, "width": 300, "height": 180 },
  "asset": "assets/3c1d9a.png"
}
```

A rectangular region captured as an image. `rect` is in CSS pixels of the page; `asset` is relative to `.comments/`.

## What each source type stores

| Source               | Typical selectors                                                         | Assets                                                    |
| -------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| HTML file            | `CssSelector`, `XPathSelector`, `TextQuoteSelector`                       | Region screenshots                                        |
| Markdown file        | `LineRangeSelector`, plus `TextQuoteSelector` for text selections         | none                                                      |
| Web page (extension) | `CssSelector`, `XPathSelector`, `TextQuoteSelector`, `ScreenshotSelector` | Screenshots                                               |
| Video / audio        | `FragmentSelector`                                                        | Keyframes (video), `transcript` when whisper is installed |

## Re-anchoring

When a file opened in the viewer changes, the daemon re-resolves every comment on it, in order of trust: CSS/XPath (accepted only if the element still contains the quote), fuzzy `TextQuoteSelector` search scored with prefix and suffix, then `TextPositionSelector` or `LineRangeSelector` for comments with no quote. It records the result in `anchorState` and `lastResolved`:

- `ok`: found where it was.
- `moved`: found elsewhere. `lastResolved` and the `LineRangeSelector` are rewritten; the quote and structural selectors are left as the reviewer created them.
- `orphaned`: content is gone; the comment is kept, detached, so nothing is lost.

## Validating comments

```sh
npx ajv-cli validate --spec=draft2020 -c ajv-formats \
  -s packages/core/schema/comment.schema.json -d ".comments/*.json"
```

Or in code: `import { parseComment } from '@comment-everything/core'` (inside the monorepo) throws on invalid input or an unsupported `schemaVersion`.
