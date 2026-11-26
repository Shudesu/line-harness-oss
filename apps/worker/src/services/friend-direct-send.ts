import { jstNow } from '@line-crm/db';
import type { Friend as DbFriend } from '@line-crm/db';
import { buildMessage } from './step-delivery.js';

/**
 * 友だち1人への push 送信 (1:1 予約送信 friend-scheduled-messages が使う)。
 * POST /api/friends/:id/messages (Idempotency-Key なしの経路) と同じ手順:
 * 送信アカウントの解決 → リンク計測 → f=<friendId> 付与 → push → messages_log (source='manual')。
 */
export interface DirectSendInput {
  messageType?: string;
  content: string;
  altText?: string | null;
  trackLinks?: boolean;
  /** /t リンクの発行元 (Worker の公開 URL)。 */
  workerUrl: string;
}

export interface DirectSendResult {
  messageId: string;
  lineAccountId: string | null;
}

export async function sendDirectMessageToFriend(
  db: D1Database,
  defaultAccessToken: string,
  friend: DbFriend,
  input: DirectSendInput,
): Promise<DirectSendResult> {
  const { LineClient } = await import('@line-crm/line-sdk');
  // 送信アカウントを1回だけ決めて、トークンと**リンクの持ち主**の両方に同じ行を使う。
  const { getLineAccountById, resolveDefaultLineAccount } = await import('@line-crm/db');
  const rawFriendAccountId =
    ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null;
  const sendAccount = rawFriendAccountId
    ? await getLineAccountById(db, rawFriendAccountId)
    : await resolveDefaultLineAccount(db);
  const friendAccountId = sendAccount?.id ?? rawFriendAccountId;
  const accessToken = sendAccount?.channel_access_token || defaultAccessToken;
  const lineClient = new LineClient(accessToken);
  const messageType = input.messageType ?? 'text';

  // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
  // trackLinks=false で明示的に短縮 OFF (URL をそのまま送る)
  let tracked = { messageType, content: input.content };
  if (input.trackLinks !== false) {
    const { autoTrackContent } = await import('./auto-track.js');
    tracked = await autoTrackContent(db, messageType, input.content, input.workerUrl, {
      lineAccountId: friendAccountId,
    });
  }
  // 1:1 送信なので /t リンクに f=<friendId> を焼き込む
  {
    const { appendFriendToTrackedLinks } = await import('./auto-track.js');
    tracked = {
      ...tracked,
      content: await appendFriendToTrackedLinks(db, tracked.content, input.workerUrl, friend.id),
    };
  }

  const message = buildMessage(tracked.messageType, tracked.content, input.altText ?? undefined);
  await lineClient.pushMessage(friend.line_user_id, [message]);

  // Log outgoing message
  const logId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
       VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'manual', ?)`,
    )
    .bind(logId, friend.id, messageType, input.content, jstNow())
    .run();

  return { messageId: logId, lineAccountId: friendAccountId };
}

