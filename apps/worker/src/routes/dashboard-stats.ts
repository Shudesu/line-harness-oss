/**
 * Phase: Dashboard 可視化 - 時系列統計 API
 *
 * GET /api/dashboard/stats?lineAccountId=&days=30
 *
 * 返り値: 過去 N 日 (デフォルト 30 日) の daily 集計 + 前期比較
 *  - friendAdds: 友だち追加 daily
 *  - friendBlocks: ブロック daily
 *  - formSubmissions: フォーム回答 daily
 *  - outgoingMessages: 配信送信 daily
 *  - incomingMessages: 受信 daily
 *  - totals: 期間合計 + 前期 (デルタ計算用)
 *
 * パフォーマンス: D1 で 30 日 × 5 系列 を 5 クエリ。1 秒未満を想定。
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';

export const dashboardStats = new Hono<Env>();

interface DailyPoint {
  date: string; // YYYY-MM-DD (JST)
  count: number;
}

interface SeriesResult {
  series: DailyPoint[];
  total: number;
  prevTotal: number;
}

dashboardStats.get('/api/dashboard/stats', async (c) => {
  const days = Math.min(90, Math.max(7, Number(c.req.query('days') ?? '30')));
  const lineAccountId = c.req.query('lineAccountId') ?? null;

  // バリデーション: lineAccountId は UUID 形式
  if (lineAccountId && !/^[a-f0-9-]{32,36}$/i.test(lineAccountId)) {
    return c.json({ success: false, error: 'invalid lineAccountId format' }, 400);
  }

  const accountFilter = lineAccountId
    ? 'AND (line_account_id = ? OR line_account_id IS NULL)'
    : '';
  const accountBinds = lineAccountId ? [lineAccountId] : [];

  // 共通: 過去 N 日 + 前期 N 日 を JST で日別集計
  // SQLite datetime() で +9 hours 補正済の文字列前提
  // X.column を strftime('%Y-%m-%d', X.column, '+9 hours') で日付化、または既に '+9 hours' 済なら slice
  // ここは既存 jstNow() format に合わせ datetime() を経由してから日付抽出する
  const buildDailyCounts = async (
    sql: string,
    binds: unknown[],
  ): Promise<SeriesResult> => {
    const r = await c.env.DB.prepare(sql).bind(...binds).all<{
      date: string;
      count: number;
      period: 'curr' | 'prev';
    }>();
    const seriesMap = new Map<string, number>();
    let total = 0;
    let prevTotal = 0;
    for (const row of r.results ?? []) {
      if (row.period === 'curr') {
        seriesMap.set(row.date, row.count);
        total += row.count;
      } else {
        prevTotal += row.count;
      }
    }
    // 欠損日を 0 で埋める (フロントで sparkline 連続線にするため)
    const series: DailyPoint[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCHours(d.getUTCHours() + 9); // JST 化
      d.setUTCDate(d.getUTCDate() - i);
      const ymd = d.toISOString().slice(0, 10);
      series.push({ date: ymd, count: seriesMap.get(ymd) ?? 0 });
    }
    return { series, total, prevTotal };
  };

  // 友だち追加 (friends.created_at)
  const friendAddsSql = `
    SELECT strftime('%Y-%m-%d', created_at) as date,
           COUNT(*) as count,
           CASE
             WHEN datetime(created_at) >= datetime('now', '+9 hours', '-${days} days') THEN 'curr'
             WHEN datetime(created_at) >= datetime('now', '+9 hours', '-${days * 2} days') THEN 'prev'
           END as period
      FROM friends
     WHERE datetime(created_at) >= datetime('now', '+9 hours', '-${days * 2} days') ${accountFilter}
     GROUP BY date, period
     ORDER BY date ASC`;

  // ブロック (friends.is_following=0 and updated_at since)
  // 注: 正確には unfollow webhook イベントを別テーブルで保持する方が確実だが
  // 現状 messages_log にも記録ないので friends.updated_at + is_following=0 で代用
  const blocksSql = `
    SELECT strftime('%Y-%m-%d', updated_at) as date,
           COUNT(*) as count,
           CASE
             WHEN datetime(updated_at) >= datetime('now', '+9 hours', '-${days} days') THEN 'curr'
             WHEN datetime(updated_at) >= datetime('now', '+9 hours', '-${days * 2} days') THEN 'prev'
           END as period
      FROM friends
     WHERE is_following = 0
       AND datetime(updated_at) >= datetime('now', '+9 hours', '-${days * 2} days') ${accountFilter}
     GROUP BY date, period
     ORDER BY date ASC`;

  // フォーム回答 (form_submissions.created_at)
  // Codex P1 修正: lineAccountId フィルタを friend 経由で適用 (NULL は除外、厳密一致のみ)
  const formsAccountFilter = lineAccountId
    ? 'AND f.line_account_id = ?'
    : '';
  const formsSql = `
    SELECT strftime('%Y-%m-%d', fs.created_at) as date,
           COUNT(*) as count,
           CASE
             WHEN datetime(fs.created_at) >= datetime('now', '+9 hours', '-${days} days') THEN 'curr'
             WHEN datetime(fs.created_at) >= datetime('now', '+9 hours', '-${days * 2} days') THEN 'prev'
           END as period
      FROM form_submissions fs
      LEFT JOIN friends f ON f.id = fs.friend_id
     WHERE datetime(fs.created_at) >= datetime('now', '+9 hours', '-${days * 2} days') ${formsAccountFilter}
     GROUP BY date, period
     ORDER BY date ASC`;

  // 配信送信 (messages_log direction=outgoing)
  const outgoingSql = `
    SELECT strftime('%Y-%m-%d', created_at) as date,
           COUNT(*) as count,
           CASE
             WHEN datetime(created_at) >= datetime('now', '+9 hours', '-${days} days') THEN 'curr'
             WHEN datetime(created_at) >= datetime('now', '+9 hours', '-${days * 2} days') THEN 'prev'
           END as period
      FROM messages_log
     WHERE direction = 'outgoing'
       AND datetime(created_at) >= datetime('now', '+9 hours', '-${days * 2} days') ${accountFilter}
     GROUP BY date, period
     ORDER BY date ASC`;

  // 受信 (messages_log direction=incoming)
  const incomingSql = `
    SELECT strftime('%Y-%m-%d', created_at) as date,
           COUNT(*) as count,
           CASE
             WHEN datetime(created_at) >= datetime('now', '+9 hours', '-${days} days') THEN 'curr'
             WHEN datetime(created_at) >= datetime('now', '+9 hours', '-${days * 2} days') THEN 'prev'
           END as period
      FROM messages_log
     WHERE direction = 'incoming'
       AND datetime(created_at) >= datetime('now', '+9 hours', '-${days * 2} days') ${accountFilter}
     GROUP BY date, period
     ORDER BY date ASC`;

  try {
    const [friendAdds, blocks, forms, outgoing, incoming] = await Promise.all([
      buildDailyCounts(friendAddsSql, accountBinds),
      buildDailyCounts(blocksSql, accountBinds),
      buildDailyCounts(formsSql, accountBinds), // Codex P1 修正
      buildDailyCounts(outgoingSql, accountBinds),
      buildDailyCounts(incomingSql, accountBinds),
    ]);
    return c.json({
      success: true,
      data: {
        days,
        friendAdds,
        blocks,
        forms,
        outgoing,
        incoming,
      },
    });
  } catch (err) {
    console.error('[dashboard-stats] error:', err);
    return c.json({ success: false, error: 'internal error' }, 500);
  }
});
