import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  SETTING_DEFINITION_MAP,
  SETTING_DEFINITIONS,
  serializeStoredSettingValue,
  setAccountSetting,
  settingScope,
} from '../services/account-settings-store.js';

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

// GET /api/account-settings/definitions
accountSettings.get('/api/account-settings/definitions', async (c) => {
  return c.json({
    success: true,
    data: SETTING_DEFINITIONS.map((definition) => ({
      key: definition.key,
      label: definition.label,
      category: definition.category,
      secret: definition.secret,
      description: definition.description,
    })),
  });
});

// GET /api/account-settings/config?accountId=xxx&category=discord
accountSettings.get('/api/account-settings/config', async (c) => {
  const accountId = settingScope(c.req.query('accountId'));
  const category = c.req.query('category');
  const definitions = SETTING_DEFINITIONS.filter((definition) => (
    category ? definition.category === category : true
  ));

  if (category && definitions.length === 0) {
    return c.json({ success: false, error: 'Unknown settings category' }, 400);
  }

  const rows = await c.env.DB
    .prepare(
      `SELECT key, value FROM account_settings
       WHERE line_account_id = ?`,
    )
    .bind(accountId)
    .all<{ key: string; value: string }>();
  const values = new Map(rows.results.map((row) => [row.key, row.value]));

  return c.json({
    success: true,
    data: definitions.map((definition) => {
      const rawValue = values.get(definition.key) ?? null;
      const serialized = serializeStoredSettingValue(definition, rawValue);
      return {
        key: definition.key,
        label: definition.label,
        category: definition.category,
        secret: definition.secret,
        description: definition.description,
        ...serialized,
      };
    }),
  });
});

// PUT /api/account-settings/config
accountSettings.put('/api/account-settings/config', async (c) => {
  const body = await c.req.json<{
    accountId?: string | null;
    values?: Record<string, string | null | undefined>;
  }>();
  const accountId = settingScope(body.accountId);
  const values = body.values ?? {};
  const updated: Array<{ key: string; configured: boolean; encrypted: boolean }> = [];

  for (const [key, value] of Object.entries(values)) {
    const definition = SETTING_DEFINITION_MAP.get(key);
    if (!definition) {
      return c.json({ success: false, error: `Unknown settings key: ${key}` }, 400);
    }

    const normalized = typeof value === 'string' ? value : '';
    const result = await setAccountSetting(c.env.DB, c.env, key, normalized, accountId);
    updated.push({ key, ...result });
  }

  return c.json({ success: true, data: { accountId, updated } });
});

export { accountSettings };
