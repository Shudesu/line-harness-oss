import { Hono } from 'hono';
import {
  getFriendById,
  getFriendByLineUserId,
  getLineAccountById,
  jstNow,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { buildMessage } from '../services/step-delivery.js';
import type { Env } from '../index.js';

const push = new Hono<Env>();

/**
 * POST /api/push — 外部システムから特定のLINEユーザーへメッセージを送る。
 *
 * 例: 応募フォーム（aidedekiru.com）で応募が確定したタイミングで、
 * 応募者本人のLINEへ受付メッセージを自動送信する。
 *
 * 友だち追加されていない相手には送信できないため 404、ブロック中は 409 を返し、
 * 呼び出し側が「送れなかった」ことを判別できるようにする。
 */
push.post('/api/push', async (c) => {
  try {
    const body = await c.req.json<{
      lineUserId?: string;
      friendId?: string;
      messageType?: string;
      content: string;
      altText?: string;
    }>();

    if (!body.content) {
      return c.json({ success: false, error: 'content is required' }, 400);
    }
    if (!body.lineUserId && !body.friendId) {
      return c.json({ success: false, error: 'lineUserId or friendId is required' }, 400);
    }

    const db = c.env.DB;
    const friend = body.friendId
      ? await getFriendById(db, body.friendId)
      : await getFriendByLineUserId(db, body.lineUserId!);

    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    if (!friend.is_following) {
      return c.json({ success: false, error: 'Friend is not following (blocked)' }, 409);
    }

    // アカウント別のアクセストークンを解決（マルチアカウント対応）
    let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (friend.line_account_id) {
      const account = await getLineAccountById(db, friend.line_account_id);
      if (account) accessToken = account.channel_access_token;
    }

    const messageType = body.messageType ?? 'text';
    const lineClient = new LineClient(accessToken);
    await lineClient.pushMessage(friend.line_user_id, [
      buildMessage(messageType, body.content, body.altText),
    ]);

    // 送信履歴に記録（管理画面の個別チャットから追えるようにする）
    const logId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
         VALUES (?, ?, 'outgoing', ?, ?, ?)`,
      )
      .bind(logId, friend.id, messageType, body.content, jstNow())
      .run();

    return c.json({ success: true, data: { messageId: logId, friendId: friend.id } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('POST /api/push error:', message);
    return c.json({ success: false, error: message }, 500);
  }
});

export { push };
