/**
 * Before/after Markdown pairs for the re-anchoring fixture suite. `target` is the rendered text
 * the comment was made on; `expect` is a substring that must sit on the first line of the new
 * range, or null when the content was deleted (the comment must become orphaned).
 */
export interface MarkdownCase {
  name: string;
  before: string;
  after: string;
  target: string;
  /** `lines`: comment stores only a LineRange; otherwise quote + LineRange like the viewer does. */
  mode?: 'lines';
  /** Which occurrence of `target` in the old text the comment was made on (default first). */
  occurrence?: 'last';
  expect: string | null;
}

const doc = (...lines: string[]) => lines.join('\n') + '\n';

const INTRO = 'Welcome to the guide. It covers installation and everyday usage.';
const API = 'The client retries failed requests three times before giving up.';
const CACHE = 'Cached responses expire after sixty seconds by default.';

export const MARKDOWN_CASES: MarkdownCase[] = [
  {
    name: 'section moved down',
    before: doc('# Guide', '', '## Install', '', 'Run the installer.', '', '## Usage', '', API),
    after: doc('# Guide', '', '## Usage', '', API, '', '## Install', '', 'Run the installer.'),
    target: API,
    expect: API,
  },
  {
    name: 'lines inserted above',
    before: doc('# Notes', '', CACHE, '', 'More text.'),
    after: doc('# Notes', '', 'New line one.', 'New line two.', '', 'Another paragraph.', '', CACHE),
    target: CACHE,
    expect: CACHE,
  },
  {
    name: 'nearby text reworded',
    before: doc('# Setup', '', 'First install the package.', '', API, '', 'Then restart.'),
    after: doc('# Setup', '', 'Begin by installing the package globally.', '', API, '', 'Finally restart.'),
    target: API,
    expect: API,
  },
  {
    name: 'target lightly reworded',
    before: doc('# API', '', API, '', 'Other.'),
    after: doc('# API', '', 'The client retries failed requests four times before giving up.', '', 'Other.'),
    target: API,
    expect: 'The client retries failed requests four times',
  },
  {
    name: 'heading renamed, paragraph kept',
    before: doc('## Install', '', INTRO, '', 'Bye.'),
    after: doc('## Installation steps', '', INTRO, '', 'Bye.'),
    target: INTRO,
    expect: INTRO,
  },
  {
    name: 'bold added to target',
    before: doc('# T', '', 'Use the retry option when the network is flaky.', '', 'End.'),
    after: doc('# T', '', 'Use the **retry** option when the network is flaky.', '', 'End.'),
    target: 'Use the retry option when the network is flaky.',
    expect: 'Use the **retry** option',
  },
  {
    name: 'list item moved within list',
    before: doc('- alpha item', '- beta item', '- gamma item with details', '- delta item'),
    after: doc('- gamma item with details', '- alpha item', '- beta item', '- delta item'),
    target: 'gamma item with details',
    expect: 'gamma item with details',
  },
  {
    name: 'duplicate text picks the right one by context',
    before: doc('# A', '', 'Note: see the config file.', '', '# B', '', 'Remember to save. Note: see the config file.'),
    after: doc('# A', '', 'Intro.', '', 'Note: see the config file.', '', '# B', '', 'Remember to save. Note: see the config file.'),
    target: 'Note: see the config file.',
    occurrence: 'last',
    expect: 'Remember to save.',
  },
  {
    name: 'code fence content moved',
    before: doc('# Ex', '', '```ts', 'const answer = compute(42);', '```', '', 'After.'),
    after: doc('# Ex', '', 'After.', '', '```ts', 'const answer = compute(42);', '```'),
    target: 'const answer = compute(42);',
    expect: 'const answer = compute(42);',
  },
  {
    name: 'line-only comment follows insertion above',
    mode: 'lines',
    before: doc('# Doc', '', 'Intro line.', '', CACHE, '', 'Outro.'),
    after: doc('# Doc', '', 'Extra one.', '', 'Extra two.', '', 'Intro line.', '', CACHE, '', 'Outro.'),
    target: CACHE,
    expect: CACHE,
  },
  {
    name: 'line-only comment follows moved section',
    mode: 'lines',
    before: doc('# Doc', '', '## One', '', 'First body text here.', '', '## Two', '', API),
    after: doc('# Doc', '', '## Two', '', API, '', '## One', '', 'First body text here.'),
    target: API,
    expect: API,
  },
  {
    name: 'section deleted',
    before: doc('# Doc', '', '## Keep', '', 'Stay put.', '', '## Remove me', '', CACHE),
    after: doc('# Doc', '', '## Keep', '', 'Stay put.'),
    target: CACHE,
    expect: null,
  },
  {
    name: 'paragraph replaced by unrelated text',
    before: doc('# Doc', '', API, '', 'Tail.'),
    after: doc('# Doc', '', 'Licensing terms are described in the LICENSE file at the root.', '', 'Tail.'),
    target: API,
    expect: null,
  },
  {
    name: 'line-only comment on deleted lines',
    mode: 'lines',
    before: doc('# Doc', '', 'Keep this one.', '', CACHE, '', 'Keep that one.'),
    after: doc('# Doc', '', 'Keep this one.', '', 'Keep that one.'),
    target: CACHE,
    expect: null,
  },
  {
    name: 'unchanged file stays put',
    before: doc('# Doc', '', INTRO, '', API),
    after: doc('# Doc', '', INTRO, '', API),
    target: API,
    expect: API,
  },
];
