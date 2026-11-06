import { TOOLTIP_CSS, TooltipController, tokensCss } from '@comment-everything/overlay';
import { SHIELD_PREF_KEY } from './early-shield-registration.js';
import {
  MODE_PREFERENCES,
  getModePreference,
  setModePreference,
  type ModePreference,
} from './extension-mode.js';
import { chromeLocalStore } from './key-value-store.js';

const MODE_COPY: Record<ModePreference, { label: string; text: string; tip: string }> = {
  auto: {
    label: 'Auto',
    text: 'Use the daemon when it is running and paired, otherwise keep comments in this browser.',
    tip: 'Checks http://127.0.0.1:4317/health each time you open the panel. This is the default.',
  },
  standalone: {
    label: 'Standalone only',
    text: 'Never contact a daemon. Comments stay in this browser; export or copy them to hand them to Claude.',
    tip: 'Nothing leaves the browser. Choose this if you never run the CLI.',
  },
  daemon: {
    label: 'Daemon',
    text: 'Always use the daemon. If it is not running or paired, the panel shows setup steps instead.',
    tip: 'Choose this when you always run comment-everything serve and want Send to reach Claude.',
  },
};

const SHIELD_COPY = {
  label: 'Early keyboard shield',
  text: 'Load a tiny script before a page’s own scripts on sites where you have used the panel, so typing a comment never triggers that site’s keyboard shortcuts. Needs access to all sites; the script reads nothing.',
  tip: 'Asks Chrome for access to all sites. Leave it off if you prefer the extension to touch pages only when you click its button.',
};

const CSS = `
${tokensCss(':root')}
body{margin:0;background:var(--ce-bg);color:var(--ce-text);font:13px/1.5 var(--ce-font)}
main{max-width:560px;margin:32px auto;padding:0 16px}
h1{margin:0 0 4px;font-size:15px;font-weight:600}
p{margin:0 0 12px;color:var(--ce-text-muted)}
fieldset{margin:0 0 20px;padding:0;border:0}
legend{padding:0;margin-bottom:8px;font-size:14px;font-weight:600}
label{display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;padding:8px 10px;border:1px solid var(--ce-border);border-radius:var(--ce-radius-lg);background:var(--ce-bg-subtle);cursor:pointer}
label:has(input:checked){border-color:var(--ce-accent);background:var(--ce-accent-soft)}
label b{display:block;font-weight:600}
label span{color:var(--ce-text-muted)}
input:focus-visible{outline:2px solid var(--ce-focus);outline-offset:2px}
#status{min-height:18px;color:var(--ce-success-text)}
#status.error{color:var(--ce-danger)}
${TOOLTIP_CSS}`;

const ALL_SITES = { origins: ['<all_urls>'] };

function choice(
  type: 'radio' | 'checkbox',
  name: string,
  label: string,
  text: string,
): { row: HTMLLabelElement; input: HTMLInputElement } {
  const input = Object.assign(document.createElement('input'), { type, name });
  const body = document.createElement('div');
  const title = Object.assign(document.createElement('b'), { textContent: label });
  const detail = Object.assign(document.createElement('span'), { textContent: text });
  body.append(title, detail);
  const row = document.createElement('label');
  row.append(input, body);
  return { row, input };
}

async function main(): Promise<void> {
  const store = chromeLocalStore();
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  const app = document.getElementById('app') as HTMLElement;
  const tipLayer = document.createElement('div');
  const tips = new TooltipController(document, tipLayer);
  const status = Object.assign(document.createElement('p'), { id: 'status' });
  status.setAttribute('role', 'status');
  const say = (text: string, error = false) => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };

  const heading = Object.assign(document.createElement('h1'), {
    textContent: 'Comment Everything',
  });
  const intro = Object.assign(document.createElement('p'), {
    textContent:
      'Choose where your comments go. Changes apply the next time you open the panel on a page.',
  });

  const modes = document.createElement('fieldset');
  modes.append(Object.assign(document.createElement('legend'), { textContent: 'Mode' }));
  const current = await getModePreference(store);
  for (const mode of MODE_PREFERENCES) {
    const copy = MODE_COPY[mode];
    const { row, input } = choice('radio', 'mode', copy.label, copy.text);
    input.value = mode;
    input.checked = mode === current;
    input.dataset.mode = mode;
    tips.attach(row, { text: copy.tip });
    input.addEventListener('change', () => {
      setModePreference(store, mode).then(
        () => say(`Saved: ${copy.label}.`),
        (err: unknown) => say(`Could not save: ${(err as Error).message}`, true),
      );
    });
    modes.append(row);
  }

  const shield = document.createElement('fieldset');
  shield.append(Object.assign(document.createElement('legend'), { textContent: 'Typing safety' }));
  const { row, input: shieldInput } = choice(
    'checkbox',
    'early-shield',
    SHIELD_COPY.label,
    SHIELD_COPY.text,
  );
  shieldInput.dataset.shield = '';
  shieldInput.checked =
    (await store.get<boolean>(SHIELD_PREF_KEY)) === true &&
    (await chrome.permissions.contains(ALL_SITES));
  tips.attach(row, { text: SHIELD_COPY.tip });
  shieldInput.addEventListener('change', () => {
    void (async () => {
      try {
        if (shieldInput.checked && !(await chrome.permissions.request(ALL_SITES))) {
          shieldInput.checked = false;
          say('Access to all sites was not granted, so the early shield stays off.', true);
          return;
        }
        if (!shieldInput.checked) await chrome.permissions.remove(ALL_SITES).catch(() => false);
        await store.set(SHIELD_PREF_KEY, shieldInput.checked);
        say(shieldInput.checked ? 'Early keyboard shield is on.' : 'Early keyboard shield is off.');
      } catch (err) {
        shieldInput.checked = !shieldInput.checked;
        say(`Could not change: ${(err as Error).message}`, true);
      }
    })();
  });
  shield.append(row);

  app.append(heading, intro, modes, shield, status, tipLayer);
}

main().catch((err: unknown) => console.error('[comment-everything] options failed:', err));
