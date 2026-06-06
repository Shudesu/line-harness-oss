import { Hono } from 'hono';
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

// ─── Phase 1-A: 友だち追加時の「あいさつメッセージ」(L-TRACK 互換) ──────────
//
// LINE 公式の「あいさつメッセージ」を harness 側で上書きする。
// referralRoute.intro_template_id が無く、本テキストが設定されていれば
// follow webhook 時にここで定義した文言が push される。
// プレースホルダ: {{friend_name}} / {{account_name}}
//
// L-TRACK では「あいさつメッセージ」は単一テキストなので、ここも text に限定。
// (リッチな配信は scenario + entry_route の仕組みで既に可能)

// GET /api/account-settings/greeting?accountId=xxx
accountSettings.get('/api/account-settings/greeting', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'default_greeting_text'`
  ).bind(accountId).first<{ value: string }>();

  return c.json({
    success: true,
    data: { text: row?.value ?? null },
  });
});

// PUT /api/account-settings/greeting
accountSettings.put('/api/account-settings/greeting', async (c) => {
  let body: { accountId?: string; text?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid json' }, 400);
  }
  if (!body.accountId) {
    return c.json({ success: false, error: 'accountId required' }, 400);
  }

  const text = (body.text ?? '').trim();
  if (text.length > 5000) {
    return c.json({ success: false, error: 'text は 5000 文字以内' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');

  if (text.length === 0) {
    // 空文字なら削除 (=「設定なし」状態に戻す)
    await c.env.DB.prepare(
      `DELETE FROM account_settings WHERE line_account_id = ? AND key = 'default_greeting_text'`
    ).bind(body.accountId).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
       VALUES (?, ?, 'default_greeting_text', ?, ?, ?)
       ON CONFLICT (line_account_id, key) DO UPDATE SET value = ?, updated_at = ?`
    ).bind(id, body.accountId, text, now, now, text, now).run();
  }
  return c.json({ success: true });
});

export { accountSettings };
