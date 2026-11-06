/** Tooltip rules; shared by the overlay's shadow root and the viewer page (same tokens). */
export const TOOLTIP_CSS = `
.tip{position:fixed;z-index:2147483647;max-width:240px;padding:6px 8px;border-radius:var(--ce-radius);
  background:var(--ce-tip-bg);color:var(--ce-tip-text);font:12px/1.4 var(--ce-font);box-shadow:var(--ce-shadow);
  pointer-events:none;animation:ce-tip-in 120ms var(--ce-ease)}
.tip[hidden]{display:none}
.tip kbd{display:inline-block;margin-left:6px;padding:0 5px;border-radius:4px;font:11px/16px var(--ce-mono);
  background:rgba(127,127,127,.28);color:inherit;white-space:nowrap}
@keyframes ce-tip-in{from{opacity:0;transform:translateY(2px)}}
@media (prefers-reduced-motion:reduce){.tip{animation:none}}
`;
