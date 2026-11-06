/** Stylesheet for the overlay's shadow root. Isolated from the host page by Shadow DOM. */
export const PANEL_WIDTH_PX = 340;

export const OVERLAY_CSS = `
:host{all:initial}
*{box-sizing:border-box}
.panel{position:fixed;top:0;right:0;bottom:0;width:${PANEL_WIDTH_PX}px;z-index:2147483647;display:flex;flex-direction:column;
  background:#fff;color:#111827;border-left:1px solid #d1d5db;font:13px/1.45 system-ui,-apple-system,sans-serif;
  box-shadow:-2px 0 12px rgba(0,0,0,.08)}
header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #e5e7eb}
header strong{font-size:14px;flex:1}
.modes{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #e5e7eb}
button{font:inherit;cursor:pointer;border:1px solid #cbd5e1;background:#f8fafc;color:#111827;border-radius:6px;padding:5px 10px}
button:hover{background:#eef2f7}
button:disabled{opacity:.5;cursor:default}
button.active{background:#2563eb;border-color:#2563eb;color:#fff}
button.primary{background:#2563eb;border-color:#2563eb;color:#fff}
button.danger{color:#b91c1c}
.modes button{flex:1}
.body{flex:1;overflow:auto;padding:8px 12px}
h3{margin:10px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280}
.empty{color:#6b7280;margin:4px 0 8px}
.card{border:1px solid #e5e7eb;border-radius:8px;padding:8px;margin-bottom:8px;background:#fafafa}
.card.focus{border-color:#2563eb}
.row{display:flex;align-items:center;gap:6px}
.num{flex:none;width:20px;height:20px;border-radius:50%;background:#2563eb;color:#fff;text-align:center;font-weight:600;font-size:11px;line-height:20px}
.label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#374151}
.card button.x{border:none;background:none;padding:0 4px;color:#6b7280;font-size:16px}
textarea{width:100%;min-height:54px;margin-top:6px;resize:vertical;font:inherit;padding:6px;border:1px solid #cbd5e1;border-radius:6px}
.sent{border-left:3px solid #94a3b8;padding:4px 8px;margin-bottom:8px;background:#f8fafc;border-radius:0 6px 6px 0}
.sent.in_progress{border-color:#f59e0b}
.sent.resolved{border-color:#16a34a}
.chip{display:inline-block;font-size:11px;font-weight:600;border-radius:99px;padding:0 7px;background:#e2e8f0}
.sent.in_progress .chip{background:#fef3c7}
.sent.resolved .chip{background:#dcfce7}
.sent .text{white-space:pre-wrap;word-break:break-word;margin-top:2px}
.sent .note{margin-top:4px;color:#166534;white-space:pre-wrap;word-break:break-word}
.sent .where{color:#6b7280;font-size:11px}
footer{display:flex;gap:6px;padding:10px 12px;border-top:1px solid #e5e7eb;flex-wrap:wrap}
footer .primary{flex:1}
.toast{padding:6px 12px;font-size:12px;color:#374151;min-height:26px;border-top:1px solid #f1f5f9}
.toast.error{color:#b91c1c}
`;
