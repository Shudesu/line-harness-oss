import { Hono } from 'hono';
import {
  getLinkBaseUrl,
  setLinkBaseUrl,
  getTrackedLinkBaseUrl,
  setTrackedLinkBaseUrl,
} from '@line-crm/db';
import type { Env } from '../index.js';

const accountSettings = new Hono<Env>();

// GET /api/account-settings/test-recipients?accountId=xxx
accountSettings.get('/api/account-settings/test-recipients', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'test_recipients'`
  ).bind(accountId).first<{ value: string }>();

  const friendIds: string[] = row ? JSON.parse(row.value) : [];

  if (friendIds.length === 0) {
    return c.json({ success: true, data: [] });
  }
  const placeholders = friendIds.map(() => '?').join(',');
  const friends = await c.env.DB.prepare(
    `SELECT id, display_name, picture_url FROM friends WHERE id IN (${placeholders})`
  ).bind(...friendIds).all<{ id: string; display_name: string; picture_url: string | null }>();

  return c.json({
    success: true,
    data: friends.results.map(f => ({
      id: f.id,
      displayName: f.display_name,
      pictureUrl: f.picture_url,
    })),
  });
});

// PUT /api/account-settings/test-recipients
accountSettings.put('/api/account-settings/test-recipients', async (c) => {
  const body = await c.req.json<{ accountId: string; friendIds: string[] }>();
  if (!body.accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');

  await c.env.DB.prepare(
    `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
     VALUES (?, ?, 'test_recipients', ?, ?, ?)
     ON CONFLICT (line_account_id, key) DO UPDATE SET value = ?, updated_at = ?`
  ).bind(
    id, body.accountId, JSON.stringify(body.friendIds), now, now,
    JSON.stringify(body.friendIds), now,
  ).run();

  return c.json({ success: true });
});

// ── link_base_url (global setting, stored under sentinel '__global__') ─────────

/**
 * GET /api/account-settings/link-base-url
 * Returns the configured short-link base URL (or null if not set).
 */
accountSettings.get('/api/account-settings/link-base-url', async (c) => {
  const value = await getLinkBaseUrl(c.env.DB, '__global__');
  return c.json({ success: true, data: value });
});

/**
 * PUT /api/account-settings/link-base-url
 * Body: { value: string }
 * - Empty string clears the setting.
 * - Must start with https:// (if non-empty).
 * - Trailing slash is stripped before saving.
 */
accountSettings.put('/api/account-settings/link-base-url', async (c) => {
  const body = await c.req
    .json<{ value?: string }>()
    .catch((): { value?: string } => ({}));
  const value = typeof body.value === 'string' ? body.value : '';

  try {
    await setLinkBaseUrl(c.env.DB, '__global__', value);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation error';
    return c.json({ success: false, error: message }, 400);
  }
});

// ── tracked_link_base_url (global setting) ────────────────────────────────────
// Base domain for message tracked links (/t/<code>). The domain must route
// /t/* to the Worker (Redirect Rule or Custom Domain). Unset → WORKER_URL.

accountSettings.get('/api/account-settings/tracked-link-base-url', async (c) => {
  const value = await getTrackedLinkBaseUrl(c.env.DB, '__global__');
  return c.json({ success: true, data: value });
});

accountSettings.put('/api/account-settings/tracked-link-base-url', async (c) => {
  const body = await c.req
    .json<{ value?: string }>()
    .catch((): { value?: string } => ({}));
  const value = typeof body.value === 'string' ? body.value : '';

  try {
    await setTrackedLinkBaseUrl(c.env.DB, '__global__', value);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation error';
    return c.json({ success: false, error: message }, 400);
  }
});

export { accountSettings };
