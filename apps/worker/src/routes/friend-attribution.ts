/**
 * L-TRACK 互換: 友だち個別 attribution 取得
 *
 * GET /api/friends/:id/attribution
 *   → 友だちの最新クリック (link_clicks) と最新 ref_tracking を返す。
 *      UI の友だち詳細ページで attribution 情報の表示に使う。
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';

export const friendAttribution = new Hono<Env>();

friendAttribution.get('/api/friends/:id/attribution', async (c) => {
  const friendId = c.req.param('id');
  const lineAccountId = c.req.query('lineAccountId') ?? null;
  const db = c.env.DB;

  // Codex指摘 High: 他アカウントの friend を覗けないよう、friend の line_account_id と一致しないなら 404
  if (lineAccountId) {
    const ok = await db
      .prepare(
        `SELECT 1 FROM friends WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`,
      )
      .bind(friendId, lineAccountId)
      .first();
    if (!ok) return c.json({ success: false, error: 'friend not found' }, 404);
  }

  const click = await db
    .prepare(
      `SELECT lc.*, tl.name AS tracked_link_name, tl.media_name AS tracked_link_media
         FROM link_clicks lc
         LEFT JOIN tracked_links tl ON tl.id = lc.tracked_link_id
        WHERE lc.friend_id = ?
        ORDER BY lc.clicked_at DESC
        LIMIT 1`,
    )
    .bind(friendId)
    .first<Record<string, unknown>>();

  const ref = await db
    .prepare(
      `SELECT *
         FROM ref_tracking
        WHERE friend_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .bind(friendId)
    .first<Record<string, unknown>>();

  const firstTrack = await db
    .prepare(
      `SELECT tl.id, tl.name, tl.media_name
         FROM friends f
         LEFT JOIN tracked_links tl ON tl.id = f.first_tracked_link_id
        WHERE f.id = ?`,
    )
    .bind(friendId)
    .first<Record<string, unknown>>();

  return c.json({
    success: true,
    data: {
      firstTrackedLink: firstTrack ?? null,
      latestClick: click ?? null,
      latestRefTracking: ref ?? null,
    },
  });
});
