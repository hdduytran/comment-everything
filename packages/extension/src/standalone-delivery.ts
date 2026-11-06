import { formatPrompt } from '@comment-everything/core/browser';
import { defaultCopyText, type DeliveryConfig } from '@comment-everything/overlay';
import { askWorker } from './content-proxy-transport.js';
import type { ExportReply } from './extension-messages.js';
import type { AssetStore } from './local-asset-store.js';
import { browserClipboardWriter, copyPromptWithImages } from './rich-prompt-clipboard.js';
import { claudeInstruction } from './standalone-export-files.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The pill tooltip says plainly where the comments are. */
export const STANDALONE_MODE = {
  label: 'Extension only',
  tip: 'Extension only — comments stay in this browser',
} as const;

export interface StandaloneDeliveryOptions {
  /** Host of the page being commented on; names the export folder. */
  host: string;
  assets: AssetStore;
  doc?: Document;
}

/**
 * What the overlay offers when there is no daemon to push to: Export (files for Claude Code),
 * Copy prompt (rich when screenshots exist) and Open in Claude (blank chat, prompt on the clipboard).
 */
export function createStandaloneDelivery(opts: StandaloneDeliveryOptions): DeliveryConfig {
  const writer = browserClipboardWriter((text) => defaultCopyText(opts.doc ?? document, text));
  const copyPrompt: NonNullable<DeliveryConfig['copyPrompt']> = async (text, comments) => {
    await copyPromptWithImages(text, comments, opts.assets, writer);
  };

  return {
    mode: STANDALONE_MODE,
    assetPrefix: '',
    copyPrompt,
    primary: {
      id: 'export',
      label: 'Export',
      tip: 'Save the comments and screenshots as files in Downloads for Claude Code to read.',
      async run(comments) {
        const reply = await askWorker<ExportReply>({
          type: 'ce:export',
          host: opts.host,
          comments,
        });
        if (!reply.ok) throw new Error(reply.error);
        const sentence = claudeInstruction(reply.where);
        return {
          text: `Exported ${plural(reply.count, 'comment')}. Ask Claude Code: ${sentence}`,
          copy: { text: sentence, tip: 'Copy this sentence to paste into Claude Code.' },
        };
      },
    },
    secondary: [
      {
        id: 'open-claude',
        label: 'Open in Claude',
        tip: 'Copy the prompt, then open a blank claude.ai chat to paste it into. Nothing is sent in the address.',
        async run(comments) {
          // Copy first: the new tab steals focus, and clipboard access needs this page focused.
          await copyPrompt(formatPrompt(comments, { assetPrefix: '' }), comments);
          await askWorker({ type: 'ce:open-claude' });
          return { text: 'Prompt copied — paste in Claude' };
        },
      },
    ],
  };
}
