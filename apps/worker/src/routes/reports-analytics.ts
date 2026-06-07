/**
 * Phase: Reports 拡張 - 流入経路別 / タグ別 / 時間帯別 分析 API
 *
 * 3 つの GET エンドポイントを提供する (全部 read-only / daily aggregation):
 *  - GET /api/reports/by-source?days=30&lineAccountId=
 *      → entry_routes.name 別の友だち追加数 (上位 20 件、降順)
 *  - GET /api/reports/by-tag?days=30&lineAccountId=
 *      → tags.name 別の友だち数 (現在の付与状態、上位 20 件、降順)
 *  - GET /api/reports/by-hour?days=30&lineAccountId=
 *      → 時間帯 (0-23 時 JST) 別の incoming / outgoing メッセージ数
 *
 * バリデーション:
 *  - days は 7 / 30 / 90 のみ許可 (それ以外は 400)
 *  - lineAccountId は UUID パターン (任意)
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';

export const reportsAnalytics = new Hono<Env>();

const ALLOWED_DAYS = new Set<number>([7, 30, 90]);
const UUID_PATTERN = /^[a-f0-9-]{32,36}$/i;
const TOP_LIMIT = 20;

interface SourceRow {
  ref_code: string;
  name: string;
  count: number;
}

interface TagRow {
  tag_id: string;
  name: string;
  color: string | null;
  count: number;
}

interface HourRow {
  hour: number; // 0..23
  incoming: number;
  outgoing: number;
}

/** 共通: days / lineAccountId のパースと検証。NG なら Response 返却 (caller は即 return)。 */
function parseCommonQuery(c: {
  req: { query: (k: string) => string | undefined };
}): { days: number; lineAccountId: string | null } | { error: string } {
  const daysRaw = c.req.query('days') ?? '30';
  const days = Number(daysRaw);
  if (!ALLOWED_DAYS.has(days)) {
    return { error: 'days must be one of 7, 30, 90' };
  }
  const lineAccountId = c.req.query('lineAccountId') ?? null;
  if (lineAccountId && !UUID_PATTERN.test(lineAccountId)) {
    return { error: 'invalid lineAccountId format' };
  }
  return { days, lineAccountId };
}

// ─── /api/reports/by-source ─────────────────────────────
// entry_routes 別の友だち追加数 (友だち追加 = friends.created_at が期間内)
// friends.ref_code → entry_routes.ref_code で JOIN。NULL ref は除外。
reportsAnalytics.get('/api/reports/by-source', async (c) => {
  const parsed = parseCommonQuery(c);
  if ('error' in parsed) {
    return c.json({ success: false, error: parsed.error }, 400);
  }
  const { days, lineAccountId } = parsed;

  const accountFilter = lineAccountId ? 'AND f.line_account_id = ?' : '';
  const binds: unknown[] = [];
  if (lineAccountId) binds.push(lineAccountId);

  const sql = `
    SELECT er.ref_code AS ref_code,
           er.name AS name,
           COUNT(f.id) AS count
      FROM friends f
      JOIN entry_routes er ON er.ref_code = f.ref_code
     WHERE f.ref_code IS NOT NULL
       AND datetime(f.created_at) >= datetime('now', '+9 hours', '-${days} days')
       ${accountFilter}
     GROUP BY er.ref_code, er.name
     ORDER BY count DESC
     LIMIT ${TOP_LIMIT}`;

  try {
    const r = await c.env.DB.prepare(sql)
      .bind(...binds)
      .all<SourceRow>();
    return c.json({
      success: true,
      data: {
        days,
        rows: r.results ?? [],
      },
    });
  } catch (err) {
    console.error('[reports-analytics/by-source] error:', err);
    return c.json({ success: false, error: 'internal error' }, 500);
  }
});

// ─── /api/reports/by-tag ────────────────────────────────
// タグ別の現在の friend 数 (期間内に friend_tags.assigned_at が入ったもの)。
// 「上位 20 件」は付与数の降順。
reportsAnalytics.get('/api/reports/by-tag', async (c) => {
  const parsed = parseCommonQuery(c);
  if ('error' in parsed) {
    return c.json({ success: false, error: parsed.error }, 400);
  }
  const { days, lineAccountId } = parsed;

  const accountJoin = lineAccountId
    ? 'JOIN friends f ON f.id = ft.friend_id AND f.line_account_id = ?'
    : 'JOIN friends f ON f.id = ft.friend_id';
  const binds: unknown[] = [];
  if (lineAccountId) binds.push(lineAccountId);

  const sql = `
    SELECT t.id AS tag_id,
           t.name AS name,
           t.color AS color,
           COUNT(DISTINCT ft.friend_id) AS count
      FROM friend_tags ft
      ${accountJoin}
      JOIN tags t ON t.id = ft.tag_id
     WHERE datetime(ft.assigned_at) >= datetime('now', '+9 hours', '-${days} days')
     GROUP BY t.id, t.name, t.color
     ORDER BY count DESC
     LIMIT ${TOP_LIMIT}`;

  try {
    const r = await c.env.DB.prepare(sql)
      .bind(...binds)
      .all<TagRow>();
    return c.json({
      success: true,
      data: {
        days,
        rows: r.results ?? [],
      },
    });
  } catch (err) {
    console.error('[reports-analytics/by-tag] error:', err);
    return c.json({ success: false, error: 'internal error' }, 500);
  }
});

// ─── /api/reports/by-hour ───────────────────────────────
// 時間帯 (0-23 時 JST) 別の incoming / outgoing メッセージ数。
// messages_log.created_at は既に +9 hours 化済み (schema 参照) なので strftime をそのまま使う。
//
// アカウント絞り込み: migration 032 以前の行は messages_log.line_account_id が NULL のため、
// friends 経由で COALESCE して判定する (他アカウント混入を防ぐ)。
reportsAnalytics.get('/api/reports/by-hour', async (c) => {
  const parsed = parseCommonQuery(c);
  if ('error' in parsed) {
    return c.json({ success: false, error: parsed.error }, 400);
  }
  const { days, lineAccountId } = parsed;

  const binds: unknown[] = [];
  let fromAndWhere = `FROM messages_log ml
     WHERE datetime(ml.created_at) >= datetime('now', '+9 hours', '-${days} days')`;
  if (lineAccountId) {
    fromAndWhere = `FROM messages_log ml
      JOIN friends f ON f.id = ml.friend_id
     WHERE datetime(ml.created_at) >= datetime('now', '+9 hours', '-${days} days')
       AND COALESCE(ml.line_account_id, f.line_account_id) = ?`;
    binds.push(lineAccountId);
  }

  const sql = `
    SELECT CAST(strftime('%H', ml.created_at) AS INTEGER) AS hour,
           ml.direction AS direction,
           COUNT(*) AS count
      ${fromAndWhere}
     GROUP BY hour, ml.direction`;

  try {
    const r = await c.env.DB.prepare(sql)
      .bind(...binds)
      .all<{ hour: number; direction: 'incoming' | 'outgoing'; count: number }>();
    const map = new Map<number, { incoming: number; outgoing: number }>();
    for (let h = 0; h < 24; h++) {
      map.set(h, { incoming: 0, outgoing: 0 });
    }
    for (const row of r.results ?? []) {
      const bucket = map.get(row.hour);
      if (!bucket) continue;
      if (row.direction === 'incoming') bucket.incoming = row.count;
      else if (row.direction === 'outgoing') bucket.outgoing = row.count;
    }
    const rows: HourRow[] = [];
    for (let h = 0; h < 24; h++) {
      const v = map.get(h);
      rows.push({ hour: h, incoming: v?.incoming ?? 0, outgoing: v?.outgoing ?? 0 });
    }
    return c.json({
      success: true,
      data: {
        days,
        rows,
      },
    });
  } catch (err) {
    console.error('[reports-analytics/by-hour] error:', err);
    return c.json({ success: false, error: 'internal error' }, 500);
  }
});
