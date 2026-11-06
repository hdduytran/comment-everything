/** Styles for the scrolling content: pending cards, sent list, status chips, connect help. */
export const OVERLAY_CONTENT_CSS = `
h3{margin:16px 0 8px;font-size:12px;font-weight:600;color:var(--ce-text-muted)}
.body h3:first-child{margin-top:0}
.empty{margin:0 0 8px;color:var(--ce-text-muted)}
.card{margin-bottom:8px;padding:8px;border:1px solid var(--ce-border);border-radius:var(--ce-radius-lg);background:var(--ce-bg)}
.card:focus-within{border-color:var(--ce-accent)}
.row{display:flex;align-items:center;gap:8px}
.num{flex:none;width:20px;height:20px;border-radius:50%;background:var(--ce-accent);color:var(--ce-accent-fg);text-align:center;
  font-weight:600;font-size:11px;line-height:20px;font-variant-numeric:tabular-nums}
.label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
textarea{display:block;width:100%;min-height:64px;margin-top:8px;padding:6px 8px;resize:vertical;font:inherit;color:var(--ce-text);
  background:var(--ce-bg);border:1px solid var(--ce-border-strong);border-radius:var(--ce-radius);caret-color:var(--ce-accent)}
textarea::placeholder{color:var(--ce-text-muted);opacity:1}
textarea:focus{border-color:var(--ce-accent)}

.sent{margin-bottom:8px;padding:8px 10px;border:1px solid var(--ce-border);border-radius:var(--ce-radius-lg);background:var(--ce-bg-subtle)}
.sent.detached{border-style:dashed;border-color:var(--ce-danger)}
.sent .where{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--ce-text-muted)}
.sent .text{margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere}
.sent .note{margin-top:6px;padding:6px 8px;border-radius:var(--ce-radius);background:var(--ce-success-soft);color:var(--ce-success-text);
  font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.chip{flex:none;display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:99px;font-size:11px;font-weight:600;
  background:var(--ce-bg-hover);color:var(--ce-text-muted)}
.chip::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.chip-in_progress{background:var(--ce-warn-soft);color:var(--ce-warn-text)}
.chip-resolved{background:var(--ce-success-soft);color:var(--ce-success-text)}
.chip-detached{background:var(--ce-danger-soft);color:var(--ce-danger-text)}

.help{flex:1;overflow:auto;padding:12px}
.panel:has(.help:not([hidden])) .body{display:none}
.help-head{display:flex;align-items:center;justify-content:space-between}
.help h2{margin:0;font-size:15px;font-weight:600}
.help p{margin:12px 0 6px}
.help .muted{margin:4px 0 12px;color:var(--ce-text-muted)}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--ce-border)}
.tabs [role=tab]{height:32px;border:0;border-radius:var(--ce-radius) var(--ce-radius) 0 0;background:transparent;color:var(--ce-text-muted)}
.tabs [role=tab][aria-selected=true]{color:var(--ce-text);box-shadow:inset 0 -2px 0 var(--ce-accent)}
.cmd{display:flex;align-items:flex-start;gap:4px}
.cmd code{flex:1;min-width:0;padding:6px 8px;border:1px solid var(--ce-border);border-radius:var(--ce-radius);background:var(--ce-bg-subtle);
  font:12px/1.5 var(--ce-mono);overflow-wrap:anywhere}
.copy-cmd{flex:none;width:28px;padding:0}
.copy-cmd[data-state=copied]{color:var(--ce-success-text)}
`;
