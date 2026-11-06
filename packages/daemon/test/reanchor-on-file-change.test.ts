import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, json, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

const BODY = 'The client retries failed requests three times before giving up.';

async function sendComment(selectors: unknown[]): Promise<string> {
  const res = await env.api('/comments', {
    method: 'POST',
    body: JSON.stringify({
      root: env.project,
      comments: [{ source: 'docs/api.md', text: 'check', selectors }],
    }),
  });
  expect(res.status).toBeLessThan(300);
  return (await json(res)).comments[0].id;
}

async function editAndSettle(text: string): Promise<void> {
  await writeFile(path.join(env.project, 'docs', 'api.md'), text);
  env.daemon.service.bus.publish({ type: 'file.changed', root: env.project, path: 'docs/api.md' });
  await env.daemon.reanchor.idle();
}

describe('re-anchoring on file change', () => {
  it('follows a moved paragraph, then flags it detached when deleted', async () => {
    await writeFile(path.join(env.project, 'docs', 'api.md'), `# API\n\n${BODY}\n\nTail.\n`);
    await env.daemon.reanchor.prime(env.project, 'docs/api.md');
    const id = await sendComment([
      { type: 'LineRangeSelector', startLine: 3, endLine: 3 },
      { type: 'TextQuoteSelector', exact: BODY },
    ]);

    await editAndSettle(`# API\n\nNew intro.\n\nMore.\n\n${BODY}\n\nTail.\n`);
    let c = (await env.daemon.service.get(id))!;
    expect(c.anchorState).toBe('moved');
    expect(c.selectors[0]).toMatchObject({ startLine: 7, endLine: 7 });

    await editAndSettle(`# API\n\nNew intro.\n\nTail.\n`);
    c = (await env.daemon.service.get(id))!;
    expect(c.anchorState).toBe('orphaned');
    expect(c.status).toBe('open');
  });

  it('skips resolved comments', async () => {
    await writeFile(path.join(env.project, 'docs', 'api.md'), `# API\n\n${BODY}\n`);
    await env.daemon.reanchor.prime(env.project, 'docs/api.md');
    const id = await sendComment([{ type: 'TextQuoteSelector', exact: BODY }]);
    await env.daemon.service.update(id, { status: 'resolved' });
    await editAndSettle('# API\n');
    expect((await env.daemon.service.get(id))!.anchorState).toBeUndefined();
  });
});
