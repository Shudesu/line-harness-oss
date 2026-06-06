/**
 * Phase 1-G: Channel Access Token 暗号化 管理 API
 *
 * GET  /api/token-encryption/status        - 暗号化済み/平文 件数の集計 + キー設定有無
 * POST /api/token-encryption/migrate       - 平文の channel_access_token を一括 AES-GCM 暗号化
 *
 * 前提:
 *   - LINE_TOKEN_ENC_KEY (Worker secret) に 32 byte base64 の AES-256 マスターキーを設定
 *     (例: `openssl rand -base64 32` で生成、`wrangler secret put` で登録)
 *   - 既存 token は平文のまま動作し続ける (token-crypto.ts が "enc1:" prefix 有無で判定)
 */

import { Hono } from 'hono';
import { isEncrypted, bulkEncryptLineAccountTokens } from '../lib/token-crypto.js';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

export const tokenEncryption = new Hono<Env>();

tokenEncryption.get('/api/token-encryption/status', requireRole('owner'), async (c) => {
  const key = (c.env as unknown as { LINE_TOKEN_ENC_KEY?: string }).LINE_TOKEN_ENC_KEY;
  const rows = await c.env.DB.prepare(
    'SELECT id, channel_access_token FROM line_accounts WHERE channel_access_token IS NOT NULL',
  ).all<{ id: string; channel_access_token: string }>();
  let encrypted = 0;
  let plaintext = 0;
  for (const r of rows.results ?? []) {
    if (isEncrypted(r.channel_access_token)) encrypted++;
    else plaintext++;
  }
  return c.json({
    success: true,
    data: {
      keyConfigured: !!key && key.length > 0,
      total: (rows.results ?? []).length,
      encrypted,
      plaintext,
    },
  });
});

tokenEncryption.post('/api/token-encryption/migrate', requireRole('owner'), async (c) => {
  const key = (c.env as unknown as { LINE_TOKEN_ENC_KEY?: string }).LINE_TOKEN_ENC_KEY;
  if (!key) {
    return c.json(
      {
        success: false,
        error:
          'LINE_TOKEN_ENC_KEY が Worker secrets に未設定です。`openssl rand -base64 32` で生成し、`wrangler secret put LINE_TOKEN_ENC_KEY --config wrangler-prod.toml` で登録してください。',
      },
      503,
    );
  }
  // Codex 指摘 (高): 復号未対応サービス (broadcasts / booking / scheduled 等) があるため
  // 暗号化すると配信系が壊れる。?confirm=force を明示しないと走らない安全弁。
  const confirmParam = c.req.query('confirm');
  if (confirmParam !== 'force') {
    return c.json(
      {
        success: false,
        error:
          'migrate は破壊的: webhook 以外 (broadcasts / booking / scheduled push 等) が復号未対応のため暗号化すると配信系が壊れます。意図的に実行する場合は ?confirm=force を付けてください。',
        codexNote: 'Phase 1-G v2 (全サービス復号対応) 完了後に実行してください',
      },
      400,
    );
  }
  const result = await bulkEncryptLineAccountTokens(c.env.DB, key);
  return c.json({ success: true, data: result });
});
