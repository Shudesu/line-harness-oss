/**
 * Phase 1-H: fingerprint データの自動削除サービス
 *
 * link_clicks.user_agent / ip_address / ua_fingerprint は個人特定可能情報 (PII)。
 * 認証スキップモード (skip_liff) で広告クリック → 友だち追加突合に使うため一時的に保存しているが、
 * 突合が終わったら役目を終えているので、N日経過したら NULL クリアする。
 *
 * - レコード自体は CV 集計や監査に必要なので削除しない
 * - 3カラムを NULL に上書きするだけ
 * - 削除ジョブの履歴は fingerprint_retention_audit に残す
 *
 * 呼び出し元:
 *  - scheduled cron (毎日深夜)
 *  - 管理画面の「いますぐ削除」ボタン
 *  - 同意撤回 (consent_revoked) 時の即時削除
 */

import { jstNow } from '@line-crm/db';

export interface PurgeOptions {
  retentionDays: number;
  trigger: 'cron' | 'manual' | 'consent_revoked';
  notes?: string;
}

export interface PurgeResult {
  scannedRows: number;
  clearedRows: number;
  cutoffAt: string;
}

export async function purgeOldFingerprints(
  db: D1Database,
  opts: PurgeOptions,
): Promise<PurgeResult> {
  const retentionDays = Math.max(1, Math.floor(opts.retentionDays));

  // Codex 指摘 (中): clicked_at は ISO 8601 と古い 'YYYY-MM-DD HH:MM:SS' (UTC) が混在しうる。
  // 文字列比較ではなく datetime() に通してから比較することで T/スペース/+09:00 混在に強くする。
  const offset = `-${retentionDays} days`;

  const scanned = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM link_clicks
        WHERE datetime(clicked_at) < datetime('now', '+9 hours', ?)
          AND (user_agent IS NOT NULL OR ip_address IS NOT NULL OR ua_fingerprint IS NOT NULL)`,
    )
    .bind(offset)
    .first<{ cnt: number }>();
  const scannedRows = scanned?.cnt ?? 0;

  const updated = await db
    .prepare(
      `UPDATE link_clicks
          SET user_agent = NULL,
              ip_address = NULL,
              ua_fingerprint = NULL
        WHERE datetime(clicked_at) < datetime('now', '+9 hours', ?)
          AND (user_agent IS NOT NULL OR ip_address IS NOT NULL OR ua_fingerprint IS NOT NULL)`,
    )
    .bind(offset)
    .run();
  const clearedRows = updated.meta?.changes ?? 0;

  // 監査ログ用に cutoff timestamp を確定 (表示用、フィルタには使わない)
  const cutoffRow = await db
    .prepare(`SELECT datetime('now', '+9 hours', ?) as cutoff`)
    .bind(offset)
    .first<{ cutoff: string }>();
  const cutoffStr = cutoffRow?.cutoff ?? '';

  await db
    .prepare(
      `INSERT INTO fingerprint_retention_audit
        (id, ran_at, retention_days, scanned_rows, cleared_rows, trigger, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      jstNow(),
      retentionDays,
      scannedRows,
      clearedRows,
      opts.trigger,
      opts.notes ?? null,
    )
    .run();

  return { scannedRows, clearedRows, cutoffAt: cutoffStr };
}

/**
 * 同意撤回時の即時削除: retention 関係なく全件 fingerprint カラムを NULL に。
 * link_clicks レコード自体は残す (CV 集計のため)。
 */
export async function purgeAllFingerprints(
  db: D1Database,
  notes?: string,
): Promise<PurgeResult> {
  const scanned = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM link_clicks
        WHERE user_agent IS NOT NULL OR ip_address IS NOT NULL OR ua_fingerprint IS NOT NULL`,
    )
    .first<{ cnt: number }>();
  const scannedRows = scanned?.cnt ?? 0;

  const updated = await db
    .prepare(
      `UPDATE link_clicks
          SET user_agent = NULL, ip_address = NULL, ua_fingerprint = NULL
        WHERE user_agent IS NOT NULL OR ip_address IS NOT NULL OR ua_fingerprint IS NOT NULL`,
    )
    .run();
  const clearedRows = updated.meta?.changes ?? 0;

  await db
    .prepare(
      `INSERT INTO fingerprint_retention_audit
        (id, ran_at, retention_days, scanned_rows, cleared_rows, trigger, notes)
        VALUES (?, ?, 0, ?, ?, 'consent_revoked', ?)`,
    )
    .bind(crypto.randomUUID(), jstNow(), scannedRows, clearedRows, notes ?? null)
    .run();

  return { scannedRows, clearedRows, cutoffAt: '' };
}

/**
 * 現在の fingerprint 在庫を返す (管理画面で「N 件保持中、最古は M 日前」表示用)。
 */
export async function getFingerprintStats(db: D1Database): Promise<{
  totalWithFingerprint: number;
  oldestClickedAt: string | null;
}> {
  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM link_clicks
        WHERE user_agent IS NOT NULL OR ip_address IS NOT NULL OR ua_fingerprint IS NOT NULL`,
    )
    .first<{ cnt: number }>();
  const oldestRow = await db
    .prepare(
      `SELECT MIN(clicked_at) as oldest FROM link_clicks
        WHERE user_agent IS NOT NULL OR ip_address IS NOT NULL OR ua_fingerprint IS NOT NULL`,
    )
    .first<{ oldest: string | null }>();
  return {
    totalWithFingerprint: totalRow?.cnt ?? 0,
    oldestClickedAt: oldestRow?.oldest ?? null,
  };
}

export async function getRecentRetentionAudit(
  db: D1Database,
  limit: number = 20,
): Promise<
  Array<{
    id: string;
    ran_at: string;
    retention_days: number;
    scanned_rows: number;
    cleared_rows: number;
    trigger: string;
    notes: string | null;
  }>
> {
  const result = await db
    .prepare(
      `SELECT id, ran_at, retention_days, scanned_rows, cleared_rows, trigger, notes
         FROM fingerprint_retention_audit
        ORDER BY ran_at DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<{
      id: string;
      ran_at: string;
      retention_days: number;
      scanned_rows: number;
      cleared_rows: number;
      trigger: string;
      notes: string | null;
    }>();
  return result.results ?? [];
}
