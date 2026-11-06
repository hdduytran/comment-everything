/**
 * Design tokens shared by the overlay panel and the viewer chrome. `tokensCss(selector)` emits
 * the custom properties for light and dark (`prefers-color-scheme`) on whatever element the
 * caller scopes them to (`:host` inside the overlay's shadow root, `:root` in the viewer).
 * Each colour pair was checked for WCAG AA contrast (text >= 4.5:1).
 */
const LIGHT = `
  --ce-bg:#ffffff; --ce-bg-subtle:#f5f6f8; --ce-bg-hover:#eceef2;
  --ce-border:#dfe3e8; --ce-border-strong:#c3cad4;
  --ce-text:#14181f; --ce-text-muted:#5b6573;
  --ce-accent:#2456d6; --ce-accent-hover:#1e49b8; --ce-accent-fg:#ffffff;
  --ce-accent-soft:#e9effd; --ce-accent-text:#1f4bc2;
  --ce-danger:#b42318; --ce-danger-soft:#fde8e5; --ce-danger-text:#a3200f;
  --ce-success-soft:#e3f5ea; --ce-success-text:#0b6b36;
  --ce-warn-soft:#fdf0d5; --ce-warn-text:#8a4f00;
  --ce-tip-bg:#14181f; --ce-tip-text:#f3f4f6;
  --ce-shadow:0 8px 24px rgba(15,23,42,.14),0 1px 3px rgba(15,23,42,.1);
  --ce-focus:#2456d6;`;

const DARK = `
  --ce-bg:#16181d; --ce-bg-subtle:#1c1f26; --ce-bg-hover:#262a33;
  --ce-border:#2c313b; --ce-border-strong:#3b424f;
  --ce-text:#e8eaee; --ce-text-muted:#9aa3b2;
  --ce-accent:#3a68e0; --ce-accent-hover:#4a77ee; --ce-accent-fg:#ffffff;
  --ce-accent-soft:#1f2a4a; --ce-accent-text:#9db8ff;
  --ce-danger:#ff8a7d; --ce-danger-soft:#3d1a16; --ce-danger-text:#ffa196;
  --ce-success-soft:#12301f; --ce-success-text:#7fd9a0;
  --ce-warn-soft:#3a2a0c; --ce-warn-text:#f2c066;
  --ce-tip-bg:#e8eaee; --ce-tip-text:#14181f;
  --ce-shadow:0 8px 24px rgba(0,0,0,.5),0 1px 3px rgba(0,0,0,.4);
  --ce-focus:#8fb0ff;`;

/** Own font stack: the overlay never inherits the host page's typography. */
const TYPE = `
  --ce-font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --ce-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --ce-radius:6px; --ce-radius-lg:8px;
  --ce-ease:cubic-bezier(.22,1,.36,1);`;

export function tokensCss(selector: string): string {
  return `${selector}{${LIGHT}${TYPE}color-scheme:light dark}
@media (prefers-color-scheme:dark){${selector}{${DARK}}}`;
}
