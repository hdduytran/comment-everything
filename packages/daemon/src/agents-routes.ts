import type { Hono } from 'hono';
import { z } from 'zod';
import type { AgentActivityRegistry } from './agent-activity-registry.js';

/** Header the stdio proxy sets on every request so the daemon can tell its calls apart. */
export const AGENT_HEADER = 'x-ce-agent';

const HelloSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  version: z.string().max(100).optional(),
  transport: z.enum(['stdio', 'http']).default('stdio'),
  channel: z.boolean().optional(),
});

/** `GET /agents/status`, plus `hello`/`bye` used by the `mcp` stdio proxy. Token-guarded app-wide. */
export function mountAgentsRoutes(app: Hono, agents: AgentActivityRegistry): void {
  app.use('*', async (c, next) => {
    agents.touch(c.req.header(AGENT_HEADER));
    await next();
  });
  app.get('/agents/status', (c) => c.json(agents.status()));
  app.post('/agents/hello', async (c) => {
    const body = HelloSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request' }, 400);
    agents.hello(body.data);
    return c.json({ ok: true });
  });
  app.post('/agents/bye', async (c) => {
    const body = z
      .object({ id: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request' }, 400);
    agents.bye(body.data.id);
    return c.json({ ok: true });
  });
}
