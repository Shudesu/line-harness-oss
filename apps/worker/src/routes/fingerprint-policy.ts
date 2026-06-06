/**
 * Phase 1-H: fingerprint 同意 / 保存期限 管理 API
 *
 * GET  /api/fingerprint-policy           ポリシー + 在庫統計 + 最近の削除履歴
 * PUT  /api/fingerprint-policy           consent / retention_days 更新
 * POST /api/fingerprint-policy/purge     いますぐ削除実行
 *
 * ポリシーは account_settings に格納 (line_account_id = 'global' 固定キー):
 *   - fingerprint_consent: '1' (= 有効, 既定) / '0' (= 撤回)
 *   - fingerprint_retention_days: '90' (既定)
 *
 * 撤回した瞬間に全件即時削除 (consent_revoked trigger)。
 */

import { Hono } from 'hono';
import {
  purgeOldFingerprints,
  purgeAllFingerprints,
  getFingerprintStats,
  getRecentRetentionAudit,
} from '../services/fingerprint-purger.js';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

export const fingerprintPolicy = new Hono<Env>();

// Codex 指摘 (中): 'global' は実 line_account_id と衝突しうるので予約形式に
const GLOBAL_KEY = '__system__';
const CONSENT_KEY = 'fingerprint_consent';
const RETENTION_KEY = 'fingerprint_retention_days';
const DEFAULT_RETENTION = 90;

async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?')
    .bind(GLOBAL_KEY, key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  const id = crypto.randomUUID();
  const now = new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');
  await db
    .prepare(
      `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (line_account_id, key) DO UPDATE SET value = ?, updated_at = ?`,
    )
    .bind(id, GLOBAL_KEY, key, value, now, now, value, now)
    .run();
}

fingerprintPolicy.get('/api/fingerprint-policy', requireRole('owner', 'admin'), async (c) => {
  const consent = (await getSetting(c.env.DB, CONSENT_KEY)) ?? '1';
  const retention = Number((await getSetting(c.env.DB, RETENTION_KEY)) ?? DEFAULT_RETENTION);
  const stats = await getFingerprintStats(c.env.DB);
  const audit = await getRecentRetentionAudit(c.env.DB, 20);
  return c.json({
    success: true,
    data: {
      consent: consent === '1',
      retentionDays: Number.isFinite(retention) && retention > 0 ? retention : DEFAULT_RETENTION,
      stats,
      audit,
    },
  });
});

fingerprintPolicy.put('/api/fingerprint-policy', requireRole('owner'), async (c) => {
  let body: { consent?: boolean; retentionDays?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid json' }, 400);
  }

  if (body.consent !== undefined) {
    const newConsent = body.consent ? '1' : '0';
    const prevConsent = (await getSetting(c.env.DB, CONSENT_KEY)) ?? '1';
    await setSetting(c.env.DB, CONSENT_KEY, newConsent);
    // 「同意していた状態」→「撤回」の遷移で即時全削除
    if (prevConsent === '1' && newConsent === '0') {
      const result = await purgeAllFingerprints(c.env.DB, '同意撤回 (UI からの操作)');
      return c.json({
        success: true,
        purged: result,
        message: '同意を撤回し、保存済 fingerprint データを即時削除しました',
      });
    }
  }

  if (body.retentionDays !== undefined) {
    const n = Math.floor(body.retentionDays);
    if (!Number.isFinite(n) || n < 1 || n > 730) {
      return c.json({ success: false, error: 'retentionDays は 1〜730 の範囲' }, 400);
    }
    await setSetting(c.env.DB, RETENTION_KEY, String(n));
  }

  return c.json({ success: true });
});

fingerprintPolicy.post('/api/fingerprint-policy/purge', requireRole('owner', 'admin'), async (c) => {
  const retention = Number((await getSetting(c.env.DB, RETENTION_KEY)) ?? DEFAULT_RETENTION);
  const days = Number.isFinite(retention) && retention > 0 ? retention : DEFAULT_RETENTION;
  const result = await purgeOldFingerprints(c.env.DB, {
    retentionDays: days,
    trigger: 'manual',
    notes: '管理画面からの手動実行',
  });
  return c.json({ success: true, data: result });
});
