// 軌道の「二次審査」タブ用：指定した印のどれかが付いた友だちと、それぞれの印が付いた日時を返す
// （友だち一覧の API は印の名前しか返さず、予約期限・支払い期限の残り時間を出せないため）
import { Hono } from 'hono';
import type { Env } from '../index.js';

const screening = new Hono<Env>();

screening.get('/api/screening', async (c) => {
  const lineAccountId = c.req.query('lineAccountId');
  const tagIds = (c.req.query('tagIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!lineAccountId || tagIds.length === 0) {
    return c.json({ success: false, error: 'lineAccountId と tagIds が必要です' }, 400);
  }
  try {
    const marks = tagIds.map(() => '?').join(',');
    const rows = await c.env.DB
      .prepare(
        `SELECT f.id, f.display_name, f.picture_url, f.is_following, ft.tag_id, ft.assigned_at
         FROM friend_tags ft
         JOIN friends f ON f.id = ft.friend_id
         WHERE f.line_account_id = ? AND ft.tag_id IN (${marks})`,
      )
      .bind(lineAccountId, ...tagIds)
      .all<{ id: string; display_name: string | null; picture_url: string | null; is_following: number; tag_id: string; assigned_at: string }>();
    const byFriend = new Map<string, { id: string; displayName: string | null; pictureUrl: string | null; isFollowing: boolean; tags: Record<string, string> }>();
    for (const r of rows.results) {
      const f = byFriend.get(r.id) ?? { id: r.id, displayName: r.display_name, pictureUrl: r.picture_url, isFollowing: r.is_following === 1, tags: {} };
      f.tags[r.tag_id] = r.assigned_at;
      byFriend.set(r.id, f);
    }
    return c.json({ success: true, data: [...byFriend.values()] });
  } catch (err) {
    console.error('GET /api/screening error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { screening };
