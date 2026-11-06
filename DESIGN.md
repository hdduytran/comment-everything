---
name: Comment Everything
surface: operate (tool panel and viewer chrome)
source: packages/overlay/src/overlay-tokens.ts, overlay-styles.ts, overlay-styles-content.ts, tooltip-styles.ts; packages/viewer/src/viewer.css
---

# Design system

Comment Everything is a review tool that lives on top of someone else's page. The design goal is to disappear into the task: familiar controls, one restrained accent, no decoration. Brand lives in precise details (spacing, focus, copy), not in expression.

## Principles

- **Quiet by default.** Neutral surfaces, one blue accent used only for primary actions, the current selection and state. No gradients, glass or decorative motion.
- **Isolated.** The panel never inherits from the host page: the host element resets with `all: initial`, the panel has its own font stack and its own tokens.
- **Light and dark** follow `prefers-color-scheme`. Every text and control pair meets WCAG AA (4.5:1).
- **One system.** The viewer chrome (media controls, markdown, banners) reads the same tokens, injected on `:root` at startup.
- **Plain copy.** Controls name their action; tooltips say what happens and show the shortcut only when one exists.

## Tokens

Defined once in `overlay-tokens.ts` as `--ce-*` custom properties.

| Role                      | Light                 | Dark                  |
| ------------------------- | --------------------- | --------------------- |
| `--ce-bg` surface         | `#ffffff`             | `#16181d`             |
| `--ce-bg-subtle` toolbar  | `#f5f6f8`             | `#1c1f26`             |
| `--ce-bg-hover`           | `#eceef2`             | `#262a33`             |
| `--ce-border`             | `#dfe3e8`             | `#2c313b`             |
| `--ce-border-strong`      | `#c3cad4`             | `#3b424f`             |
| `--ce-text`               | `#14181f`             | `#e8eaee`             |
| `--ce-text-muted`         | `#5b6573`             | `#9aa3b2`             |
| `--ce-accent`             | `#2456d6`             | `#3a68e0`             |
| `--ce-accent-soft` / text | `#e9effd` / `#1f4bc2` | `#1f2a4a` / `#9db8ff` |
| Danger (text / soft)      | `#b42318` / `#fde8e5` | `#ff8a7d` / `#3d1a16` |
| Success (text / soft)     | `#0b6b36` / `#e3f5ea` | `#7fd9a0` / `#12301f` |
| Warning (text / soft)     | `#8a4f00` / `#fdf0d5` | `#f2c066` / `#3a2a0c` |
| Tooltip (bg / text)       | `#14181f` / `#f3f4f6` | `#e8eaee` / `#14181f` |

Status colours keep one meaning in both themes: neutral = open, amber = in progress, green = resolved, red = detached or destructive, blue = selected.

## Type

One family: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Monospace (`ui-monospace, SFMono-Regular, Menlo, Consolas`) only for commands, selectors and key caps.

Fixed scale: 11 (chips, key caps) / 12 (secondary, tooltips, toast) / 13 (body) / 14 (panel title) / 15 (help heading). Weights 400, 500 (buttons), 600 (titles, chips).

## Shape, depth, motion

- Radius 6 for controls, 8 for cards, full for chips and the connection pill.
- Spacing steps 4 / 8 / 12 / 16. Panel padding 12.
- Depth: a soft panel shadow on the docked edge and a short two-layer shadow for tooltips and the collapsed handle (offset plus blur).
- Motion 120 ms, `cubic-bezier(.22,1,.36,1)`, for hover, press (scale .98) and tooltip appearance. All of it is disabled under `prefers-reduced-motion`.

## Components

- **Panel**: fixed right, 340 px (`min(340px, 100vw)`), z-index `2147483647`; header and mode bar sit on `--ce-bg-subtle`, content on `--ce-bg`, footer on `--ce-bg-subtle`. Collapses to a 40 px handle with a pending-count badge; the host element carries `data-ce-panel="open|collapsed"` so the viewer can reclaim the margin.
- **Buttons**: 28 px high. Default (outlined), primary (filled accent), danger (red text), icon-only (borderless), link (inline action in the toast). Mode buttons are toggles (`aria-pressed`) with accent-soft fill. Inactive buttons use `aria-disabled` so they stay focusable and keep their tooltip.
- **Connection pill** in the header: dot + label. Hollow = none, blue = connected, green = watching.
- **Cards**: 1 px border, no side stripes. Pending cards highlight on `:focus-within`; sent cards use a status chip, a dashed border when detached, and a tinted note block for the agent's resolution.
- **Tooltips**: `role="tooltip"` element per control referenced by `aria-describedby`; show after 400 ms on hover or keyboard focus, `Esc` dismisses, `position: fixed` so no scroll container clips them, flipped above when there is no room below.
- **Help sheet**: inline replacement of the panel body (not a modal), tabs with arrow-key navigation, one copy button per command.
- **Focus**: 2 px ring in `--ce-focus`, 1 px offset, on every control, chip and text box.

## Icons

Authored inline SVG in `icons.ts`: 16 px grid, 1.5 px stroke, round caps and joins, `currentColor`. No emoji or text glyphs as icons.
