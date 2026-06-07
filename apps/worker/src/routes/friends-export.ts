/**
 * L-TRACK 互換: 友だち一覧の CSV エクスポート
 *
 * GET /api/friends/export.csv?format=ltrack
 *
 * カラム順は L-TRACK のエクスポート CSV に寄せる。
 * - 基本属性 (line_user_id, display_name, picture_url, is_following, created_at)
 * - first-touch attribution (ltp, fbclid, gclid, twclid, ttclid, utm_*, user_agent, ip_address)
 * - tracked_link 由来情報 (tracked_link_id, tracked_link_name, media_name)
 * - タグは "tag1|tag2|tag3" 形式で1列に
 *
 * 認証は他のadmin APIと同じ middleware に任せる（route登録時にミドルウェアを通す）。
 */

import { Hono } from 'hono';

type Env = {
  Bindings: {
    DB: D1Database;
  };
};

interface ExportRow {
  id: string;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  is_following: number;
  status_message: string | null;
  created_at: string;
  updated_at: string;
  ref_code: string | null;
  first_tracked_link_id: string | null;
  tl_name: string | null;
  tl_media_name: string | null;
  ltp: string | null;
  fbclid: string | null;
  gclid: string | null;
  twclid: string | null;
  ttclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  user_agent: string | null;
  ip_address: string | null;
  country: string | null;
  tag_names: string | null;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const HEADERS = [
  'friend_id',
  'line_user_id',
  'display_name',
  'is_following',
  'created_at',
  'updated_at',
  'status_message',
  'picture_url',
  'ref_code',
  'first_tracked_link_id',
  'tracked_link_name',
  'media_name',
  // L-TRACK 互換: attribution
  'ltp',
  'fbclid',
  'gclid',
  'twclid',
  'ttclid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'user_agent',
  'ip_address',
  'country',
  // タグ "|" 区切り
  'tags',
];

export const friendsExport = new Hono<Env>();
const app = friendsExport;

/**
 * GET /api/friends/export.csv
 *  - format=ltrack (default)
 *  - tagId=xxx (任意。指定タグ保持者のみ)
 *  - limit=10000 (デフォルト10000、安全のため上限あり)
 */
app.get('/friends/export.csv', async (c) => {
  const db = c.env.DB;
  const tagId = c.req.query('tagId') ?? null;
  // Codex指摘 High: multi-account 境界。lineAccountId を必須で受け、CSVに混ぜない。
  const lineAccountId = c.req.query('lineAccountId') ?? null;
  // Codex指摘 中: 50000 は重すぎる。デフォルト 5000、上限 10000 に引き下げ。
  const limitRaw = Number(c.req.query('limit') ?? '5000');
  const limit = Math.max(1, Math.min(10000, Number.isFinite(limitRaw) ? limitRaw : 5000));

  // C: 一括選択エクスポート対応 - ids=uuid1,uuid2,... で friend_id 列挙
  // セキュリティ: UUID 形式チェックで SQL injection を防ぐ
  const idsRaw = c.req.query('ids') ?? '';
  const idPattern = /^[a-f0-9-]{32,36}$/i;
  const requestedIds = idsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((id) => idPattern.test(id));
  // 安全のため最大 500 件まで
  if (requestedIds.length > 500) {
    return c.text('Too many ids (max 500)', 400);
  }
  const idsFilter = requestedIds.length > 0
    ? `AND f.id IN (${requestedIds.map(() => '?').join(',')})`
    : '';

  // 各 friend について、最新の attribution-bearing link_click を LEFT JOIN で1行に出す。
  // ref_tracking と link_clicks のどちらにも click_id が入る可能性があるので、
  // ここでは link_clicks（より詳細）を優先し、空欄なら ref_tracking で補完する。
  //
  // 注意: D1/SQLite で GROUP_CONCAT を使うとタグの順序が不定だが、
  // L-TRACK CSV も特に順序は保証していないので問題なし。

  const tagFilter = tagId
    ? `AND f.id IN (SELECT ft.friend_id FROM friend_tags ft WHERE ft.tag_id = ?)`
    : '';

  // Codex P1 修正: NULL 混入を防ぐため厳密一致のみ。
  // NULL 行 (旧データ・未所属) は別アカウントの CSV に出さない。
  const accountFilter = lineAccountId
    ? `AND f.line_account_id = ?`
    : '';

  const bind: unknown[] = [];
  if (tagId) bind.push(tagId);
  if (lineAccountId) bind.push(lineAccountId);
  if (requestedIds.length > 0) bind.push(...requestedIds);
  bind.push(limit);

  // Codex指摘 中: ltp も ref_tracking フォールバックする（昇格後の ref_tracking にも ltp を保存している）
  const sql = `
    SELECT
      f.id, f.line_user_id, f.display_name, f.picture_url, f.is_following,
      f.status_message, f.created_at, f.updated_at, f.ref_code,
      f.first_tracked_link_id,
      tl.name AS tl_name,
      tl.media_name AS tl_media_name,
      -- attribution: link_clicks 優先、無ければ ref_tracking で補完
      COALESCE(lc.ltp, rt.ltp) AS ltp,
      COALESCE(lc.fbclid, rt.fbclid) AS fbclid,
      COALESCE(lc.gclid, rt.gclid) AS gclid,
      COALESCE(lc.twclid, rt.twclid) AS twclid,
      COALESCE(lc.ttclid, rt.ttclid) AS ttclid,
      COALESCE(lc.utm_source, rt.utm_source) AS utm_source,
      COALESCE(lc.utm_medium, rt.utm_medium) AS utm_medium,
      COALESCE(lc.utm_campaign, rt.utm_campaign) AS utm_campaign,
      lc.utm_content AS utm_content,
      lc.utm_term AS utm_term,
      COALESCE(lc.user_agent, rt.user_agent) AS user_agent,
      COALESCE(lc.ip_address, rt.ip_address) AS ip_address,
      COALESCE(lc.country, rt.country) AS country,
      (
        SELECT GROUP_CONCAT(t.name, '|')
          FROM friend_tags ft2
          INNER JOIN tags t ON t.id = ft2.tag_id
         WHERE ft2.friend_id = f.id
      ) AS tag_names
    FROM friends f
    LEFT JOIN tracked_links tl ON tl.id = f.first_tracked_link_id
    LEFT JOIN link_clicks lc
      ON lc.friend_id = f.id
      AND lc.id = (
        SELECT id FROM link_clicks
         WHERE friend_id = f.id
         ORDER BY clicked_at DESC
         LIMIT 1
      )
    LEFT JOIN ref_tracking rt
      ON rt.friend_id = f.id
      AND rt.id = (
        SELECT id FROM ref_tracking
         WHERE friend_id = f.id
         ORDER BY created_at DESC
         LIMIT 1
      )
    WHERE 1 = 1 ${tagFilter} ${accountFilter} ${idsFilter}
    ORDER BY f.created_at DESC
    LIMIT ?
  `;

  const result = await db.prepare(sql).bind(...bind).all<ExportRow>();
  const rows = result.results ?? [];

  const lines: string[] = [];
  lines.push(HEADERS.join(','));
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.line_user_id,
        r.display_name,
        r.is_following,
        r.created_at,
        r.updated_at,
        r.status_message,
        r.picture_url,
        r.ref_code,
        r.first_tracked_link_id,
        r.tl_name,
        r.tl_media_name,
        r.ltp,
        r.fbclid,
        r.gclid,
        r.twclid,
        r.ttclid,
        r.utm_source,
        r.utm_medium,
        r.utm_campaign,
        r.utm_content,
        r.utm_term,
        r.user_agent,
        r.ip_address,
        r.country,
        r.tag_names,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  // UTF-8 BOM 付き（Excel で文字化けしないように）
  const body = '﻿' + lines.join('\r\n');

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="friends-${Date.now()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});

