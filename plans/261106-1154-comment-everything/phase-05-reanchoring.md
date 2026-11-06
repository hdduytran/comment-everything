# Phase 5 — Re-anchoring after file changes

## Requirements
- When source file changes, recompute anchors for open comments:
  1. Try CSS/XPath; verify text matches quote.
  2. Else fuzzy TextQuote search (diff-match-patch) with prefix/suffix scoring.
  3. MD: map old line range by quote search → new lines.
  4. Fail → mark `orphaned` (keep comment, show in panel as detached).
- Store last resolved position to speed up next match.

## Files
`packages/core/src/{reanchor-engine,fuzzy-text-quote-matcher}.ts`.

## Validation
- Fixture suite: 30 before/after HTML/MD pairs (rename class, move section, reword nearby text) → ≥ 90% correctly re-anchored.
