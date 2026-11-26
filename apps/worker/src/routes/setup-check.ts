import {createAuthorizedRouter} from '../middleware/authorized-router.js';
import { Hono } from 'hono';
import { getLineAccounts } from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

export const setupCheck = createAuthorizedRouter<Env>();

async function readLine(path: string, token: string): Promise<{ status: number | null; data: Record<string, unknown> | null }> {
  if (!token) return { status: null, data: null };
  try {
    const response = await fetch(`https://api.line.me/v2/bot/${path}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000),
    });
    return { status: response.status, data: response.ok ? await response.json() as Record<string, unknown> : null };
  } catch {
    return { status: null, data: null };
  }
}

setupCheck.get('/api/setup/check', requireRole('owner'), async c => {
  c.header('Cache-Control', 'no-store');
  const accounts = (await getLineAccounts(c.env.DB)).filter(a => a.is_active);
  const id = c.req.query('accountId');
  if (!id && accounts.length > 1) return c.json({ success: false, error: 'accountId is required for multiple accounts' }, 400);
  const account = id ? accounts.find(a => a.id === id) : accounts[0];
  if (id && !account) return c.json({ success: false, error: 'Active account not found' }, 404);
  // Do not mix a selected account with another account's environment credentials.
  const token = account ? account.channel_access_token : c.env.LINE_CHANNEL_ACCESS_TOKEN;
  const present = (value: string | null | undefined) => Boolean(value?.trim());
  const configured = {
    accessToken: present(token),
    channelSecret: present(account ? account.channel_secret : c.env.LINE_CHANNEL_SECRET),
    loginChannelId: present(account ? account.login_channel_id : c.env.LINE_LOGIN_CHANNEL_ID),
    loginChannelSecret: present(account ? account.login_channel_secret : c.env.LINE_LOGIN_CHANNEL_SECRET),
    liff: present(account ? account.liff_id : c.env.LIFF_URL),
    adminOrigin: present(c.env.ADMIN_ORIGIN),
  };
  const [bot, webhook] = await Promise.all([readLine('info', token ?? ''), readLine('channel/webhook/endpoint', token ?? '')]);
  const expectedEndpoint = `${new URL(c.req.url).origin}/webhook`;
  return c.json({ success: true, data: {
    accountId: account?.id ?? null,
    configured,
    bot: { status: bot.status, reachable: bot.status === 200 && typeof bot.data?.userId === 'string', basicId: typeof bot.data?.basicId === 'string' ? bot.data.basicId : null },
    webhook: { status: webhook.status, active: webhook.data?.active === true, endpointMatches: webhook.data?.endpoint === expectedEndpoint },
    manualChecks: ['Verify webhook signature in LINE Developers', 'Confirm Login provider, publication, callback URL, LIFF endpoint and scopes'],
    // Presence/GET checks cannot validate the channel secret or a real OAuth login.
    secretsVerified: false,
  } });
});
