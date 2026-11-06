/**
 * Before/after HTML pairs for the re-anchoring fixture suite. The comment is created on `before`
 * either by picking the element matching `pick.css` or by selecting `pick.text`. `expect` is a
 * substring the re-resolved target's text must contain, or null when the content is gone.
 */
export interface HtmlCase {
  name: string;
  before: string;
  after: string;
  pick: { css: string } | { text: string; nth?: number };
  expect: string | null;
}

const LEAD = 'Our platform ships weekly and every release is backed by an automated test suite.';
const PRICE = 'Plans start at nine dollars per month with no setup fee.';

export const HTML_CASES: HtmlCase[] = [
  {
    name: 'class renamed',
    before: `<main><section><h2>Pricing</h2><button class="cta">Start your free trial</button></section></main>`,
    after: `<main><section><h2>Pricing</h2><button class="btn-primary">Start your free trial</button></section></main>`,
    pick: { css: 'button.cta' },
    expect: 'Start your free trial',
  },
  {
    name: 'id renamed',
    before: `<div><p id="lead">${LEAD}</p><p>Other.</p></div>`,
    after: `<div><p id="intro-copy">${LEAD}</p><p>Other.</p></div>`,
    pick: { css: '#lead' },
    expect: LEAD,
  },
  {
    name: 'section moved to the end',
    before: `<main><section id="a"><p>${PRICE}</p></section><section id="b"><p>Contact us anytime.</p></section></main>`,
    after: `<main><section id="b"><p>Contact us anytime.</p></section><section id="a"><p>${PRICE}</p></section></main>`,
    pick: { css: '#a p' },
    expect: PRICE,
  },
  {
    name: 'nearby text reworded',
    before: `<article><h1>Release notes</h1><p>Version two is out.</p><p>${LEAD}</p><p>Thanks for reading.</p></article>`,
    after: `<article><h1>What is new</h1><p>Version three is now available.</p><p>${LEAD}</p><p>Thank you all.</p></article>`,
    pick: { css: 'article p:nth-of-type(2)' },
    expect: LEAD,
  },
  {
    name: 'wrapped in extra containers',
    before: `<body><div><p>${PRICE}</p></div></body>`,
    after: `<body><div class="outer"><div class="inner"><span><p>${PRICE}</p></span></div></div></body>`,
    pick: { css: 'p' },
    expect: PRICE,
  },
  {
    name: 'list reordered',
    before: `<ul><li>Alpha feature list</li><li>Bravo feature list</li><li>Charlie feature list</li></ul>`,
    after: `<ul><li>Charlie feature list</li><li>Alpha feature list</li><li>Bravo feature list</li></ul>`,
    pick: { css: 'li:nth-of-type(3)' },
    expect: 'Charlie feature list',
  },
  {
    name: 'selected text, paragraph moved',
    before: `<div><p>First intro paragraph.</p><p>${LEAD}</p></div>`,
    after: `<div><p>${LEAD}</p><p>First intro paragraph.</p></div>`,
    pick: { text: 'every release is backed by an automated test suite' },
    expect: 'every release is backed by an automated test suite',
  },
  {
    name: 'selected text, inline element inserted nearby',
    before: `<p>Remember to <em>save</em> your work before closing the editor window.</p>`,
    after: `<p>Remember to <em>save</em> your <strong>important</strong> work before closing the editor window.</p>`,
    pick: { text: 'before closing the editor window' },
    expect: 'before closing the editor window',
  },
  {
    name: 'element text lightly reworded',
    before: `<div><p class="note">The export may take several minutes for large projects.</p></div>`,
    after: `<div><p class="note">The export can take several minutes for very large projects.</p></div>`,
    pick: { css: 'p.note' },
    expect: 'several minutes',
  },
  {
    name: 'selected text lightly reworded',
    before: `<p>Intro. The scheduler runs every fifteen minutes and retries failures. Outro.</p>`,
    after: `<p>Intro. The scheduler runs every thirty minutes and retries failures. Outro.</p>`,
    pick: { text: 'The scheduler runs every fifteen minutes and retries failures' },
    expect: 'scheduler runs every thirty minutes',
  },
  {
    name: 'duplicate text resolved by context',
    before: `<div><div class="card"><h3>Alpha</h3><a>Read more</a></div><div class="card"><h3>Beta</h3><a>Read more</a></div></div>`,
    after: `<div><div class="card"><h3>Beta</h3><a>Read more</a></div><div class="card"><h3>Alpha</h3><a>Read more</a></div></div>`,
    pick: { text: 'Read more', nth: 1 },
    expect: 'Read more',
  },
  {
    name: 'tag and class changed',
    before: `<div><p class="warning">Back up your data before upgrading to the new major version.</p></div>`,
    after: `<div><aside class="callout">Back up your data before upgrading to the new major version.</aside></div>`,
    pick: { css: 'p.warning' },
    expect: 'Back up your data',
  },
  {
    name: 'section deleted',
    before: `<main><section id="a"><h2>Keep</h2><p>Stay here.</p></section><section id="b"><p>${PRICE}</p></section></main>`,
    after: `<main><section id="a"><h2>Keep</h2><p>Stay here.</p></section></main>`,
    pick: { css: '#b p' },
    expect: null,
  },
  {
    name: 'selected text deleted',
    before: `<div><p>Keep this sentence.</p><p>This warning paragraph will vanish entirely soon.</p></div>`,
    after: `<div><p>Keep this sentence.</p></div>`,
    pick: { text: 'This warning paragraph will vanish entirely soon.' },
    expect: null,
  },
  {
    name: 'same selector now points at unrelated content',
    before: `<main><h2>Pricing</h2><p>${PRICE}</p></main>`,
    after: `<main><h2>Pricing</h2><p>Licensing questions are answered in the legal handbook.</p></main>`,
    pick: { css: 'main p' },
    expect: null,
  },
];
