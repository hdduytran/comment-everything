import { OVERLAY_CONTENT_CSS } from './overlay-styles-content.js';
import { tokensCss } from './overlay-tokens.js';
import { TOOLTIP_CSS } from './tooltip-styles.js';

/** Stylesheet for the overlay's shadow root. Isolated from the host page by Shadow DOM. */
export const PANEL_WIDTH_PX = 340;

const BASE_CSS = `
:host{all:initial}
*{box-sizing:border-box}
.shell{font:13px/1.45 var(--ce-font);color:var(--ce-text);-webkit-text-size-adjust:100%;text-size-adjust:100%;
  scrollbar-width:thin;scrollbar-color:var(--ce-border-strong) transparent}
[hidden]{display:none!important}
::selection{background:color-mix(in srgb,var(--ce-accent) 30%,transparent)}

.panel{position:fixed;top:0;right:0;bottom:0;width:min(${PANEL_WIDTH_PX}px,100vw);z-index:2147483647;display:flex;flex-direction:column;
  background:var(--ce-bg);border-left:1px solid var(--ce-border);box-shadow:-6px 0 20px rgba(15,23,42,.08)}
.shell[data-collapsed] .panel{display:none}
.handle{display:none;position:fixed;top:16px;right:0;z-index:2147483647;width:40px;height:40px;padding:0;
  align-items:center;justify-content:center;border:1px solid var(--ce-accent);border-right:0;border-radius:var(--ce-radius-lg) 0 0 var(--ce-radius-lg);
  background:var(--ce-accent);color:var(--ce-accent-fg);box-shadow:var(--ce-shadow)}
.handle:hover{background:var(--ce-accent-hover)}
.shell[data-collapsed] .handle{display:flex}
.badge{position:absolute;top:-6px;left:-6px;min-width:18px;height:18px;padding:0 4px;border-radius:99px;background:var(--ce-bg);
  color:var(--ce-accent-text);border:1px solid var(--ce-accent);font:600 11px/16px var(--ce-font);text-align:center;font-variant-numeric:tabular-nums}
.badge:empty{display:none}

header{padding:12px 12px 10px;background:var(--ce-bg-subtle)}
.title-row{display:flex;align-items:center;gap:2px}
.title-row strong{flex:1;font-size:14px;font-weight:600;letter-spacing:-.005em}
.agent{display:inline-flex;align-items:center;gap:7px;max-width:100%;height:auto;margin-top:8px;padding:3px 10px 3px 8px;
  border-color:transparent;border-radius:99px;background:var(--ce-bg-hover);color:var(--ce-text-muted);font-size:12px}
.agent-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{flex:none;width:8px;height:8px;border-radius:50%;border:1.5px solid var(--ce-text-muted)}
.agent[data-kind=connected] .dot{background:var(--ce-accent-text);border-color:var(--ce-accent-text)}
.agent[data-kind=local] .dot{background:var(--ce-text-muted)}
.agent[data-kind=watching] .dot{background:var(--ce-success-text);border-color:var(--ce-success-text)}
.agent[data-kind=watching]{color:var(--ce-success-text);background:var(--ce-success-soft)}
.modes{display:flex;gap:6px;padding:0 12px 12px;background:var(--ce-bg-subtle);border-bottom:1px solid var(--ce-border)}
.body{flex:1;overflow:auto;padding:12px}

button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 10px;font:inherit;font-size:12.5px;
  font-weight:500;cursor:pointer;border:1px solid var(--ce-border-strong);border-radius:var(--ce-radius);background:var(--ce-bg);
  color:var(--ce-text);transition:background-color 120ms var(--ce-ease),border-color 120ms var(--ce-ease),transform 120ms var(--ce-ease)}
button:hover{background:var(--ce-bg-hover)}
button:active{transform:scale(.98)}
button:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--ce-focus);outline-offset:1px}
button[aria-disabled=true]{opacity:.5;cursor:default;pointer-events:auto}
button[aria-disabled=true]:hover{background:var(--ce-bg)}
button[aria-disabled=true]:active{transform:none}
button.primary{flex:1;background:var(--ce-accent);border-color:var(--ce-accent);color:var(--ce-accent-fg)}
button.primary:hover{background:var(--ce-accent-hover)}
button.primary[aria-disabled=true]:hover{background:var(--ce-accent)}
button.wide{flex:1 0 100%}
button.danger{color:var(--ce-danger)}
button.mode{flex:1}
button.mode[aria-pressed=true]{background:var(--ce-accent-soft);border-color:var(--ce-accent);color:var(--ce-accent-text)}
button.icon-btn{width:28px;padding:0;border-color:transparent;background:transparent;color:var(--ce-text-muted)}
button.icon-btn:hover{background:var(--ce-bg-hover);color:var(--ce-text)}
button.link{height:auto;padding:0;border:0;background:none;color:var(--ce-accent-text);text-decoration:underline;text-underline-offset:2px}
button.ghost{height:24px;border-color:transparent;background:transparent;color:var(--ce-text-muted)}
button.agent:hover{background:var(--ce-bg-hover);filter:brightness(.97)}
footer{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-top:1px solid var(--ce-border);background:var(--ce-bg-subtle)}
.toast{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid var(--ce-border);background:var(--ce-bg-subtle);font-size:12px;color:var(--ce-text)}
.toast.error{color:var(--ce-danger)}
.toast-text{min-width:0;overflow-wrap:anywhere}
.toast button{flex:none}
@media (prefers-reduced-motion:reduce){button{transition:none}}
`;

export const OVERLAY_CSS = [tokensCss(':host'), BASE_CSS, OVERLAY_CONTENT_CSS, TOOLTIP_CSS].join(
  '\n',
);
