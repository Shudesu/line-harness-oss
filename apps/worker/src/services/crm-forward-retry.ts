/**
 * P1 (2026-06-07): CRM forward の retry queue processor。
 *
 * scheduled handler の 5min tick から呼ばれる。crm_forward_queue 内の
 * due な row を fetch (next_retry_at <= now) → 再送 → 成功なら delete /
 * 失敗なら attempt++ で次回 due を更新 / 6回失敗で DLQ。
 *
 * - 1 tick あたり最大 50 row を処理 (Cloudflare Worker のサブリクエスト 1k 制限内)
 * - 各 retry の fetch は 10秒タイムアウト (crm-forwarder と同じ)
 * - signature は enqueue 時点で計算済の値をそのまま流用 (channel_secret rotation 耐性)
 * - 全件 Promise.allSettled で並列処理
 */

import {
  getDueCrmForwardQueueItems,
  deleteCrmForwardQueueItem,
  bumpCrmForwardQueueItem,
  logCrmForwardResult,
} from '@line-crm/db';

const TIMEOUT_MS = 10_000;
const BATCH_LIMIT = 50;

interface CrmForwardRow {
  webhook_url: string;
  is_enabled: number;
}

/**
 * queue の due row を順番に処理する。エラーは個別 row に閉じ込めて全体を継続。
 *
 * @returns 処理結果サマリ (運用ログ用)
 */
export async function processCrmForwardRetries(
  db: D1Database,
): Promise<{ processed: number; sent: number; requeued: number; dlq: number }> {
  const items = await getDueCrmForwardQueueItems(db, BATCH_LIMIT);
  if (items.length === 0) return { processed: 0, sent: 0, requeued: 0, dlq: 0 };

  let sent = 0;
  let requeued = 0;
  let dlq = 0;

  // Promise.allSettled で並列化するが、retry 試行数が増えると D1 への書き込みが
  // 増える。50 row × 平均 2 DB write = 100 writes/tick、Worker の制限内に収まる。
  const results = await Promise.allSettled(
    items.map(async (item) => {
      // forward 設定を取得 (削除 / 無効化されていたら DLQ 扱い)。
      const fwd = await db
        .prepare(`SELECT webhook_url, is_enabled FROM crm_forwards WHERE id = ?`)
        .bind(item.crm_forward_id)
        .first<CrmForwardRow>();

      if (!fwd) {
        // 親レコードが消えている → ON DELETE CASCADE で row も消えているはずだが
        // race の場合に備えて明示的に削除する。
        await deleteCrmForwardQueueItem(db, item.id);
        return 'dlq' as const;
      }
      if (!fwd.is_enabled) {
        // 一時無効化されている間は retry を止めるのが運用的に正しい。
        // queue には残し、次回 cron で is_enabled になったら再試行する。
        // ただし next_retry_at を 24h 後にずらして無駄打ちを防ぐ。
        await bumpCrmForwardQueueItem(
          db,
          item.id,
          // attempt は増やさず、次回 due だけずらすため引数調整。
          // 簡略化のため bumpCrmForwardQueueItem の attempt-1 を渡して
          // increment 後に元の値になるようにする (DLQ 判定に影響しない)。
          Math.max(0, item.attempt - 1),
          'forward disabled, retry deferred',
        );
        return 'requeued' as const;
      }

      // 再送実施。signature は enqueue 時点の channel_secret で計算済のものを流用。
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'hyhome-harness-crm-forwarder/1.0',
      };
      if (item.signature) headers['X-Line-Signature'] = item.signature;

      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let success = false;
      let error = '';
      let httpStatus: number | null = null;
      try {
        const r = await fetch(fwd.webhook_url, {
          method: 'POST',
          headers,
          body: item.raw_body,
          signal: controller.signal,
        });
        httpStatus = r.status;
        success = r.ok;
        if (!r.ok) error = `HTTP ${r.status}`;
      } catch (e) {
        const isAbort =
          e instanceof Error && (e.name === 'AbortError' || e.message.includes('aborted'));
        error = isAbort
          ? `timeout after ${TIMEOUT_MS}ms`
          : e instanceof Error
            ? e.message
            : String(e);
      } finally {
        clearTimeout(timer);
      }
      const duration = Date.now() - startedAt;

      if (success) {
        await deleteCrmForwardQueueItem(db, item.id);
        await logCrmForwardResult(db, {
          crmForwardId: item.crm_forward_id,
          status: 'sent',
          httpStatus,
          durationMs: duration,
          errorMessage: null,
        });
        return 'sent' as const;
      }

      // 失敗 → attempt++ で次回 due 更新、DLQ なら row 削除済。
      const outcome = await bumpCrmForwardQueueItem(db, item.id, item.attempt, error);
      await logCrmForwardResult(db, {
        crmForwardId: item.crm_forward_id,
        status: outcome === 'dlq' ? 'failed_permanent' : 'failed',
        httpStatus,
        durationMs: duration,
        errorMessage: error,
      });
      return outcome;
    }),
  );

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    if (r.value === 'sent') sent++;
    else if (r.value === 'requeued') requeued++;
    else if (r.value === 'dlq') dlq++;
  }

  return { processed: items.length, sent, requeued, dlq };
}
