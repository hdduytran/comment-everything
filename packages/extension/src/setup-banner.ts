import { HOST_ATTR } from '@comment-everything/overlay';
import { GLOBAL_FOLDER } from './origin-to-project-mapping.js';
import type { StatusReply } from './extension-messages.js';

export const SERVE_HINT = 'npx comment-everything serve';

type SetupStatus = Exclude<StatusReply, { state: 'ready' }>;

export interface SetupActions {
  retry(): void;
  pair(): void;
  chooseRoot(root: string): void;
}

const CSS = `
:host{all:initial}
.bar{position:fixed;top:12px;right:12px;z-index:2147483647;width:340px;box-sizing:border-box;
 font:14px/1.45 system-ui,sans-serif;color:#0f172a;background:#fff;border:1px solid #cbd5e1;
 border-radius:10px;padding:14px;box-shadow:0 8px 28px rgba(15,23,42,.25)}
h2{margin:0 0 6px;font-size:15px}p{margin:0 0 10px}
code{background:#f1f5f9;padding:2px 5px;border-radius:4px;word-break:break-all}
select{width:100%;margin-bottom:10px;padding:6px;font:inherit}
button{font:inherit;padding:6px 12px;margin-right:6px;border-radius:6px;border:1px solid #2563eb;
 background:#2563eb;color:#fff;cursor:pointer}
button.secondary{background:#fff;color:#2563eb}`;

function copyFor(status: SetupStatus): { title: string; body: Node[] } {
  const text = (s: string) => document.createTextNode(s);
  const code = (s: string) => Object.assign(document.createElement('code'), { textContent: s });
  switch (status.state) {
    case 'daemon-down':
      return {
        title: 'Daemon is not running',
        body: [text('Start it in a terminal, then retry: '), code(SERVE_HINT)],
      };
    case 'unpaired':
      return {
        title: 'Pair with the daemon',
        body: [text('Allow this browser to send comments to your local daemon (one-time).')],
      };
    case 'needs-root':
      return {
        title: 'Where should comments go?',
        body: [text('Pick the project that serves '), code(status.origin), text('.')],
      };
  }
}

/**
 * Small Shadow-DOM card shown instead of the overlay while the extension is not ready:
 * daemon down (with the start hint), pairing needed, or a project to choose for this origin.
 * Returns a function that removes it.
 */
export function showSetupBanner(
  doc: Document,
  status: SetupStatus,
  actions: SetupActions,
): () => void {
  const host = doc.createElement('div');
  host.setAttribute(HOST_ATTR, '');
  host.setAttribute('data-ce-setup', status.state);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const bar = doc.createElement('div');
  bar.className = 'bar';
  const { title, body } = copyFor(status);
  const h = doc.createElement('h2');
  h.textContent = title;
  const p = doc.createElement('p');
  p.append(...body);
  bar.append(h, p);

  const button = (label: string, ce: string, onClick: () => void, secondary = false) => {
    const b = doc.createElement('button');
    b.textContent = label;
    b.setAttribute('data-ce', ce);
    if (secondary) b.className = 'secondary';
    b.addEventListener('click', onClick);
    return b;
  };

  if (status.state === 'daemon-down') {
    bar.append(button('Retry', 'retry', actions.retry));
  } else if (status.state === 'unpaired') {
    bar.append(button('Pair', 'pair', actions.pair), button('Retry', 'retry', actions.retry, true));
  } else {
    const select = doc.createElement('select');
    select.setAttribute('data-ce', 'root-select');
    for (const r of status.roots) select.append(new Option(r.root, r.root));
    select.append(new Option('No project (save in ~/.comment-everything)', GLOBAL_FOLDER));
    bar.append(
      select,
      button('Use this project', 'save-root', () => actions.chooseRoot(select.value)),
    );
  }
  shadow.append(style, bar);
  doc.documentElement.append(host);
  return () => host.remove();
}
