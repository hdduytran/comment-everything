# Phase 1 — Monorepo + core schema & storage

## Context
Everything else depends on one comment schema. Use W3C Web Annotation shapes so other tools can interoperate.

## Requirements
- pnpm workspace, TypeScript strict, tsup builds, vitest, eslint/prettier, GitHub Actions CI.
- `core` exports:
  - `Comment` type: `id`, `source` (file path relative to project root, or URL), `selectors[]`, `text`, `status` (`open|in_progress|resolved`), `resolution?` (agent note), `assets[]` (keyframe/screenshot paths), `transcript?`, `createdAt`, `updatedAt`, `batchId`.
  - Selectors: `TextQuoteSelector` (exact/prefix/suffix), `TextPositionSelector`, `CssSelector`, `XPathSelector`, `LineRangeSelector` (custom: startLine/endLine for MD/source), `FragmentSelector` with media fragment `t=start,end`, `ScreenshotSelector` (custom: rect + image asset).
  - zod schemas + JSON Schema export (published in repo for other tools).
  - Storage: one JSON per comment `.comments/<id>.json`, assets in `.comments/assets/`; atomic write (tmp + rename); file watcher emitting change events.
  - Project root resolution: nearest dir with `.git` or `.comments`; fallback `~/.comment-everything/<host>/` for web URLs.
  - `formatPrompt(comments)` → Markdown prompt (source, anchor, quote, comment, asset paths).

## Files
`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/core/src/{comment-schema,selector-schemas,comment-storage,project-root-resolver,prompt-formatter}.ts`.

## Validation
- Unit tests: schema round-trip, atomic write under concurrent writes, prompt snapshot test.
- `.comments/` example fixtures committed.

## Risk / rollback
Schema churn later is costly → add `schemaVersion` field from day one.
