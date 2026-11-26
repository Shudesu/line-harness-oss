import { validateOutboundUrl } from '../lib/outbound-url.js';
import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { createExtensionTicket } from '@line-harness/sdk';
import { staffBurstLimit } from '../middleware/rate-limit.js';
import type { Env } from '../index.js';
const app = createAuthorizedRouter<Env>();
const rank = { staff: 0, admin: 1, owner: 2 };
interface Extension {
  id: string;
  name: string;
  url: string;
  minRole: keyof typeof rank;
  launch: 'none' | 'ticket';
}
export function configuredExtensions(env: {
  ADMIN_EXTENSIONS?: string;
  ADMIN_EXTENSION_SECRETS?: string;
}): { entries: Extension[]; secrets: Record<string, string> } {
  try {
    const input = JSON.parse(env.ADMIN_EXTENSIONS ?? '[]');
    const secrets = JSON.parse(env.ADMIN_EXTENSION_SECRETS ?? '{}');
    if (
      !Array.isArray(input) ||
      input.length > 50 ||
      !secrets ||
      Array.isArray(secrets) ||
      typeof secrets !== 'object'
    )
      return { entries: [], secrets: {} };
    const seen = new Set<string>();
    const entries: Extension[] = [];
    for (const entry of input) {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        !/^[a-z0-9_-]{1,64}$/.test(entry.id) ||
        seen.has(entry.id)
      )
        continue;
      seen.add(entry.id);
      const checked = validateOutboundUrl(entry.url);
      if (!checked.ok) continue;
      const url = new URL(entry.url);
      const minRole = entry.minRole ?? 'admin';
      if (
        !Object.hasOwn(rank, minRole) ||
        (entry.launch !== undefined &&
          !['none', 'ticket'].includes(entry.launch))
      )
        continue;
      const launch = entry.launch ?? 'none';
      if (
        launch === 'ticket' &&
        (!Object.hasOwn(secrets, entry.id) ||
          typeof secrets[entry.id] !== 'string' ||
          new TextEncoder().encode(secrets[entry.id]).length < 32)
      )
        continue;
      entries.push({
        id: entry.id,
        name:
          typeof entry.name === 'string' ? entry.name.slice(0, 100) : entry.id,
        url: url.toString(),
        minRole,
        launch,
      });
    }
    return { entries, secrets };
  } catch {
    return { entries: [], secrets: {} };
  }
}
app.get('/api/admin/extensions', (c) => {
  const staff = c.get('staff');
  return c.json({
    success: true,
    data: configuredExtensions(c.env).entries.filter(
      (e) => rank[staff.role] >= rank[e.minRole],
    ),
  });
});
app.post(
  '/api/admin/extensions/:id/launch',
  staffBurstLimit('extension-launch', 30),
  async (c) => {
    const staff = c.get('staff');
    if (staff.machine) return c.json({ error: 'Human identity required' }, 403);
    const { entries, secrets } = configuredExtensions(c.env);
    const extension = entries.find((e) => e.id === c.req.param('id'));
    if (!extension || extension.launch !== 'ticket')
      return c.json({ error: 'Not found' }, 404);
    if (rank[staff.role] < rank[extension.minRole])
      return c.json({ error: 'insufficient_role' }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      accountId?: unknown;
    };
    const issuer = new URL(c.env.WORKER_URL || c.req.url).origin;
    const result = await createExtensionTicket(
      {
        aud: 'lh-ext:' + extension.id,
        iss: issuer,
        sub: staff.id,
        name: staff.name,
        role: staff.role,
        ...(typeof body.accountId === 'string' && body.accountId.length <= 128
          ? { acct: body.accountId }
          : {}),
      },
      secrets[extension.id],
    );
    c.header('Cache-Control', 'no-store');
    console.info('[ext-launch] staff=' + staff.id + ' ext=' + extension.id);
    return c.json({ success: true, data: result });
  },
);
export default app;
