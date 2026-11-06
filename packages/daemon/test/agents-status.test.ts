import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentActivityRegistry, type AgentsStatus } from '../src/index.js';
import { createTestEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.cleanup());

const status = async () => (await (await env.api('/agents/status')).json()) as AgentsStatus;
const post = (path: string, body: unknown) =>
  env.api(path, { method: 'POST', body: JSON.stringify(body) });

describe('GET /agents/status', () => {
  it('requires the token', async () => {
    expect((await fetch(`${env.daemon.url}/agents/status`)).status).toBe(401);
  });

  it('starts empty', async () => {
    expect(await status()).toEqual({ connected: [], watching: false, everConnected: false });
  });

  it('tracks a stdio proxy: hello, waiting in /batches/next, bye', async () => {
    const id = 'stdio:test-1';
    await post('/agents/hello', { id, name: 'claude-code', version: '2.0', transport: 'stdio' });
    let s = await status();
    expect(s.everConnected).toBe(true);
    expect(s.connected).toMatchObject([
      { name: 'claude-code', transport: 'stdio', watching: false },
    ]);
    expect(s.watching).toBe(false);

    const wait = env.api('/batches/next?timeoutSec=5', { headers: { 'x-ce-agent': id } });
    await expect.poll(async () => (await status()).watching, { timeout: 3000 }).toBe(true);

    // A Send releases the waiter, after which the client is connected but no longer watching.
    await post('/comments', {
      root: env.project,
      comments: [{ source: 'index.html', selectors: [], text: 'hi', assets: [] }],
    });
    expect((await wait).status).toBe(200);
    await expect.poll(async () => (await status()).watching, { timeout: 3000 }).toBe(false);
    expect((await status()).connected).toHaveLength(1);

    await post('/agents/bye', { id });
    s = await status();
    expect(s.connected).toEqual([]);
    expect(s.everConnected).toBe(true);
  });

  it('rejects malformed hello bodies', async () => {
    expect((await post('/agents/hello', { name: 'x' })).status).toBe(400);
  });

  it('records /mcp HTTP clients from the initialize handshake', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${env.daemon.url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${env.daemon.token}` } },
    });
    const client = new Client({ name: 'claude-ai', version: '9.9' });
    await client.connect(transport);
    const s = await status();
    expect(s.connected).toContainEqual(
      expect.objectContaining({
        name: 'claude-ai',
        version: '9.9',
        transport: 'http',
        watching: false,
      }),
    );
    await client.close();
  });
});

describe('agents.changed SSE event', () => {
  it('is published when a client connects', async () => {
    const ctrl = new AbortController();
    const res = await env.api('/events', { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    };
    await readUntil('event: ready');
    await post('/agents/hello', { id: 'stdio:sse', name: 'sse-client', transport: 'stdio' });
    await readUntil('event: agents.changed');
    expect(text).toMatch(/event: agents\.changed\ndata: .*sse-client/);
    ctrl.abort();
    await post('/agents/bye', { id: 'stdio:sse' });
  });
});

describe('AgentActivityRegistry', () => {
  it('expires stdio clients that stop heartbeating and announces changes', () => {
    let t = 1_000;
    const seen: AgentsStatus[] = [];
    const reg = new AgentActivityRegistry(
      undefined,
      (s) => seen.push(s),
      () => t,
    );
    reg.hello({ id: 'a', name: 'claude-code', transport: 'stdio', channel: true });
    expect(reg.status().connected[0]).toMatchObject({ watching: true, channel: true });
    expect(reg.status().watching).toBe(true);
    t += 5 * 60_000;
    expect(reg.status().connected).toEqual([]);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('emits agents.changed only when membership or watching changes', async () => {
    const seen: AgentsStatus[] = [];
    const reg = new AgentActivityRegistry(undefined, (s) => seen.push(s));
    reg.hello({ id: 'a', name: 'x', transport: 'stdio' });
    reg.hello({ id: 'a', name: 'x', transport: 'stdio' }); // heartbeat
    expect(seen).toHaveLength(1);
    await reg.trackWait('a', async () => {
      expect(seen).toHaveLength(2);
    });
    expect(seen).toHaveLength(3);
    expect(seen.map((s) => s.watching)).toEqual([false, true, false]);
  });
});
