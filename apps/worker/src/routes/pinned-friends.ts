/**
 * Pinned Friends API (migration 070).
 *
 * チャット一覧で「最上部に固定したい friend」をスタッフ単位で管理する。
 *
 * - GET    /api/pinned-friends            : 自分がピン留めしている friend 一覧
 * - POST   /api/pinned-friends/:friendId  : ピン留め
 * - DELETE /api/pinned-friends/:friendId  : ピン留め解除
 *
 * セキュリティ:
 *   - staff が自分の line_account_id 配下の friend しかピン留めできない (069 の隔離を継承)
 *   - 他 staff のピン留め一覧は閲覧不能 (常に自分のものだけ返す)
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';
import { jstNow } from '@line-crm/db';

const pinnedFriends = new Hono<{
  Bindings: Env;
  Variables: { staff: { id: string; role: string; line_account_id: string | null } };
}>();

// GET /api/pinned-friends
pinnedFriends.get('/api/pinned-friends', async (c) => {
  const staff = c.get('staff');
  try {
    const r = await c.env.DB.prepare(
      `SELECT pf.friend_id, pf.pinned_at, f.display_name, f.picture_url
         FROM pinned_friends pf
         JOIN friends f ON f.id = pf.friend_id
        WHERE pf.staff_id = ?
        ORDER BY pf.pinned_at DESC`,
    )
      .bind(staff.id)
      .all<{ friend_id: string; pinned_at: string; display_name: string | null; picture_url: string | null }>();
    return c.json({ success: true, data: r.results });
  } catch (err) {
    console.error('GET /api/pinned-friends error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/pinned-friends/:friendId
pinnedFriends.post('/api/pinned-friends/:friendId', async (c) => {
  const staff = c.get('staff');
  const friendId = c.req.param('friendId');
  try {
    // friend が staff の line_account に紐付くか検証 (テナント境界保護)
    const friend = await c.env.DB.prepare(
      `SELECT id, line_account_id FROM friends WHERE id = ?`,
    )
      .bind(friendId)
      .first<{ id: string; line_account_id: string }>();
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    // Codex Round 5 Critical: staff.line_account_id が NULL なら拒否（069 と同じ安全側 fail 方針）。
    // 旧コードは `if (staff.line_account_id && ...)` で NULL を通していたため、紐付け未完の staff が
    // 任意 tenant の friend を pin できる cross-tenant 越境バグだった。
    if (!staff.line_account_id) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    if (friend.line_account_id !== staff.line_account_id) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }

    const now = jstNow();
    await c.env.DB.prepare(
      `INSERT INTO pinned_friends (staff_id, friend_id, line_account_id, pinned_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(staff_id, friend_id) DO UPDATE SET pinned_at = excluded.pinned_at`,
    )
      .bind(staff.id, friendId, friend.line_account_id, now)
      .run();
    return c.json({ success: true });
  } catch (err) {
    console.error('POST /api/pinned-friends error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/pinned-friends/:friendId
pinnedFriends.delete('/api/pinned-friends/:friendId', async (c) => {
  const staff = c.get('staff');
  const friendId = c.req.param('friendId');
  try {
    await c.env.DB.prepare(
      `DELETE FROM pinned_friends WHERE staff_id = ? AND friend_id = ?`,
    )
      .bind(staff.id, friendId)
      .run();
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/pinned-friends error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { pinnedFriends };
