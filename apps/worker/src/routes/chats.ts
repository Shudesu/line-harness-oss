import { Hono } from 'hono';
import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getOperators,
  getOperatorById,
  createOperator,
  updateOperator,
  deleteOperator,
  getChats,
  getChatById,
  createChat,
  getFriendById,
  getLineAccountById,
  updateChat,
  jstNow,
} from '@line-crm/db';
import type { Env } from '../index.js';

const chats = new Hono<Env>();

function clampLoadingSeconds(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : 5;
  return Math.min(60, Math.max(5, n));
}

async function startLoadingAnimation(
  accessToken: string,
  chatId: string,
  loadingSeconds: number,
): Promise<void> {
  const response = await fetch('https://api.line.me/v2/bot/chat/loading/start', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chatId, loadingSeconds }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      detail
        ? `LINE API error: ${response.status} - ${detail}`
        : `LINE API error: ${response.status}`,
    );
  }
}

type ChatLike = {
  id: string;
  friend_id: string;
  operator_id: string | null;
  status: string;
  notes: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

// id は chats.id もしくは friend.id のどちらか。friend.id のときは chats 行を遅延作成する。
// push / broadcast / scenario 配信だけを受けた友だちもチャット画面に現れるため、ここで lazy create が必要。
// 新規作成する場合は status='resolved' にし、last_message_at は messages_log の実際の最終時刻を使う
// （jstNow を入れると一覧並び順が壊れるため）。
async function resolveOrCreateChat(db: D1Database, id: string): Promise<ChatLike | null> {
  const existing = await getChatById(db, id);
  if (existing) return existing as ChatLike;
  const friend = await getFriendById(db, id);
  if (!friend) return null;
  // 最新行を選ぶ (unanswered-inbox / conversations の latest_chat CTE と同じ基準)。
  // 最古行を選ぶと、旧重複データがある DB で読み手と別の行に status を書いてしまう。
  const byFriend = await db
    .prepare(`SELECT * FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(friend.id)
    .first<ChatLike>();
  if (byFriend) return byFriend;

  const lastMsg = await db
    .prepare(
      `SELECT MAX(created_at) AS last FROM messages_log WHERE friend_id = ? AND (delivery_type IS NULL OR delivery_type != 'test')`,
    )
    .bind(friend.id)
    .first<{ last: string | null }>();
  const newId = crypto.randomUUID();
  const now = jstNow();
  const lastMessageAt = lastMsg?.last ?? null;
  // 同時実行で二重挿入されないように WHERE NOT EXISTS + OR IGNORE で原子挿入。
  // 挿入結果に関わらず最新行を返して収束。
  await db
    .prepare(
      `INSERT OR IGNORE INTO chats (id, friend_id, status, last_message_at, created_at, updated_at)
       SELECT ?, ?, 'resolved', ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM chats WHERE friend_id = ?)`,
    )
    .bind(newId, friend.id, lastMessageAt, now, now, friend.id)
    .run();
  return (await db
    .prepare(`SELECT * FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(friend.id)
    .first<ChatLike>())!;
}

async function resolveFriendAndAccessToken(
  db: D1Database,
  friendId: string,
  defaultAccessToken: string,
) {
  const friend = await getFriendById(db, friendId);
  if (!friend) {
    return { friend: null, accessToken: defaultAccessToken };
  }

  if (!friend.line_account_id) {
    return { friend, accessToken: defaultAccessToken };
  }

  const account = await getLineAccountById(db, friend.line_account_id);
  if (!account) {
    return { friend, accessToken: defaultAccessToken };
  }

  return { friend, accessToken: account.channel_access_token };
}

// ========== オペレーターCRUD ==========

chats.get('/api/operators', async (c) => {
  try {
    const items = await getOperators(c.env.DB);
    return c.json({
      success: true,
      data: items.map((o) => ({
        id: o.id,
        name: o.name,
        email: o.email,
        role: o.role,
        isActive: Boolean(o.is_active),
        createdAt: o.created_at,
        updatedAt: o.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/operators error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.post('/api/operators', async (c) => {
  try {
    const body = await c.req.json<{ name: string; email: string; role?: string }>();
    if (!body.name || !body.email) return c.json({ success: false, error: 'name and email are required' }, 400);
    const item = await createOperator(c.env.DB, body);
    return c.json({ success: true, data: { id: item.id, name: item.name, email: item.email, role: item.role } }, 201);
  } catch (err) {
    console.error('POST /api/operators error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.put('/api/operators/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateOperator(c.env.DB, id, body);
    const updated = await getOperatorById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, email: updated.email, role: updated.role, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/operators/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.delete('/api/operators/:id', async (c) => {
  try {
    await deleteOperator(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/operators/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== チャットCRUD ==========

chats.get('/api/chats', async (c) => {
  try {
    const status = c.req.query('status') ?? undefined;
    const operatorId = c.req.query('operatorId') ?? undefined;
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;
    const unansweredOnly =
      c.req.query('unansweredOnly') === 'true' || c.req.query('unansweredOnly') === '1';

    let unansweredMap: Map<string, { lastIncomingAt: string; lastIncomingContent: string; lastIncomingType: string }> | null = null;
    if (unansweredOnly) {
      const { getUnansweredRowsMap } = await import('../services/unanswered-inbox.js');
      unansweredMap = await getUnansweredRowsMap(c.env.DB);
      // 空 Map のとき = 未対応ゼロ。早期 return で空配列を返す。
      if (unansweredMap.size === 0) {
        return c.json({ success: true, data: [] });
      }
    }

    // List everyone who has any message history (incoming or outgoing — push/broadcast/scenario included)
    // PLUS any chats row that exists even before any messages_log entry is written.
    // Source = messages_log ∪ chats.friend_id; chats は status/operator/notes 用に LEFT JOIN で最新1件だけ採用。
    //
    // recent_msg CTE で friend_id ごとに最新の messages_log 行をひとつ取得し、本文 preview と
    // direction (incoming/outgoing) を一覧に出す。
    //
    // パフォーマンス対策 (2026-07-06 本番実測で全面改修):
    //   旧実装は messages_log (96k 行) を ROW_NUMBER × 2 + GROUP BY で 3 回スキャンし、
    //   さらに LIMIT なしで全 friend (10k 行) を返していた → 本番 D1 実測 3.47 秒 / 781k rows_read。
    //   新実装は (a) ROW_NUMBER を argmax GROUP BY に置換 (SQLite の bare-column +
    //   単一 MAX() は max 行の値を返す documented 挙動)、(b) CTE を MATERIALIZED して
    //   二重評価を防止、(c) page CTE で先に対象 friend を limit 件に確定してから
    //   preview を計算、(d) デフォルト LIMIT 300 (最終行は last_message_at DESC)。
    //   同条件の本番実測: 459ms / 165k rows_read (LIMIT 300 時)。
    //   - content は text のみ先頭 200 文字まで切り詰めて返す (flex/image など raw JSON を
    //     返すと broadcast 後の rows で multi-MB レスポンスになる)。
    //   - lineAccountId 指定時は messages_log スキャンを対象アカの friend に絞る。
    const accountFilterSql = lineAccountId
      ? `friend_id IN (SELECT id FROM friends WHERE line_account_id = ?)`
      : `1=1`;

    // unansweredOnly は取得後に unansweredMap と突合して絞るため全件必要。
    // SQLite は LIMIT に負値を渡すと「無制限」になる (documented 挙動)。
    const NO_LIMIT = -1;
    const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10);
    const limit = unansweredOnly
      ? NO_LIMIT
      : Number.isFinite(limitParam)
        ? Math.min(1000, Math.max(1, limitParam))
        : 300;
    // カーソルページング: (last_message_at, friend_id) の複合カーソルより古い行を返す。
    // offset 方式は「取得の合間に新着で行が押し下げられた分が欠落する」構造問題が
    // あるため採用しない。friend_id は同時刻 (broadcast 一斉配信等) のタイブレーク。
    const beforeAt = c.req.query('beforeAt') || undefined;
    const beforeId = c.req.query('beforeId') || undefined;
    const useCursor = !unansweredOnly && Boolean(beforeAt && beforeId);

    const conditions: string[] = [];
    const conditionBindings: unknown[] = [];
    if (status) {
      conditions.push(`COALESCE(c.status, 'resolved') = ?`);
      conditionBindings.push(status);
    }
    if (operatorId) {
      conditions.push('c.operator_id = ?');
      conditionBindings.push(operatorId);
    }
    if (lineAccountId) {
      conditions.push('f.line_account_id = ?');
      conditionBindings.push(lineAccountId);
    }
    // status / operator filter は chats を参照するので、その時だけ page CTE 側でも
    // chats を lookup する (無条件時は 全friend × chats lookup を省く)。
    const pageNeedsChats = Boolean(status || operatorId);

    // preview は **最新の incoming (ユーザー発)** を優先する。auto_reply / scenario 等の
    // outbound が直後に書き込まれて preview を上書きすると「ユーザーが何と言ったか」が
    // 一覧から見えなくなる (operator triage の主目的が損なわれる)。
    // incoming が無い (broadcast push など outbound only) chat は最新 outbound にフォールバック。
    // text 以外 (flex/image/sticker 等) は content を NULL にして payload size を抑える
    // (フロントは type で 📋 Flex / 📷 画像 等のラベルを出すので content は不要)。
    // any_agg / in_agg の bare column (content 等) は「単一 MAX() を含む集約は max 行の
    // 値を返す」という SQLite の documented 挙動で argmax として使っている。
    // 集約は page 確定後の friend に絞って実行する (全 friend 分の content を
    // materialize しない)。last_any は並び順決定専用のスリムな全走査 1 回のみ。
    const sql = `
      WITH last_any AS MATERIALIZED (
        SELECT friend_id, MAX(created_at) AS last_message_at
        FROM messages_log
        WHERE (delivery_type IS NULL OR delivery_type != 'test')
          AND ${accountFilterSql}
        GROUP BY friend_id
      ),
      deduped AS MATERIALIZED (
        SELECT friend_id, MAX(last_message_at) AS last_message_at FROM (
          SELECT friend_id, last_message_at FROM last_any
          UNION ALL
          SELECT friend_id, last_message_at FROM chats WHERE ${accountFilterSql}
        ) GROUP BY friend_id
      ),
      page AS MATERIALIZED (
        SELECT d.friend_id, d.last_message_at
        FROM deduped d
        INNER JOIN friends f ON f.id = d.friend_id
        ${pageNeedsChats ? `LEFT JOIN chats c ON c.id = (
          SELECT id FROM chats WHERE friend_id = f.id ORDER BY created_at DESC LIMIT 1
        )` : ''}
        WHERE 1=1
        ${conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : ''}
        ${useCursor ? 'AND (d.last_message_at < ? OR (d.last_message_at = ? AND d.friend_id < ?))' : ''}
        ORDER BY d.last_message_at DESC, d.friend_id DESC
        LIMIT ?
      ),
      any_agg AS (
        SELECT friend_id,
          CASE WHEN message_type = 'text' THEN SUBSTR(content, 1, 200) ELSE NULL END AS content,
          direction, message_type,
          MAX(created_at) AS created_at
        FROM messages_log
        WHERE (delivery_type IS NULL OR delivery_type != 'test')
          AND friend_id IN (SELECT friend_id FROM page)
        GROUP BY friend_id
      ),
      in_agg AS (
        SELECT friend_id,
          CASE WHEN message_type = 'text' THEN SUBSTR(content, 1, 200) ELSE NULL END AS content,
          message_type,
          MAX(created_at) AS created_at
        FROM messages_log
        WHERE direction = 'incoming'
          AND (delivery_type IS NULL OR delivery_type != 'test')
          AND friend_id IN (SELECT friend_id FROM page)
        GROUP BY friend_id
      ),
      recent_msg AS (
        SELECT a.friend_id,
          COALESCE(i.content, a.content) AS content,
          CASE WHEN i.friend_id IS NOT NULL THEN 'incoming' ELSE a.direction END AS direction,
          COALESCE(i.message_type, a.message_type) AS message_type,
          COALESCE(i.created_at, a.created_at) AS preview_at
        FROM any_agg a
        LEFT JOIN in_agg i ON i.friend_id = a.friend_id
      )
      SELECT
        f.id AS id,
        f.id AS friend_id,
        f.display_name,
        f.picture_url,
        f.line_user_id,
        f.line_account_id,
        c.operator_id,
        COALESCE(c.status, 'resolved') AS status,
        c.notes,
        COALESCE(rm.preview_at, d.last_message_at) AS last_message_at,
        rm.content AS last_message_content,
        rm.direction AS last_message_direction,
        rm.message_type AS last_message_type,
        COALESCE(c.created_at, d.last_message_at) AS created_at,
        COALESCE(c.updated_at, d.last_message_at) AS updated_at
      FROM page d
      INNER JOIN friends f ON f.id = d.friend_id
      LEFT JOIN chats c ON c.id = (
        SELECT id FROM chats WHERE friend_id = f.id ORDER BY created_at DESC LIMIT 1
      )
      LEFT JOIN recent_msg rm ON rm.friend_id = f.id
      ORDER BY d.last_message_at DESC, d.friend_id DESC
    `;

    // placeholder 順 = SQL 出現順: last_any(account) → deduped 内 chats(account) →
    // page 条件 → cursor (beforeAt ×2 + beforeId) → LIMIT。
    // any_agg / in_agg は page で friend が確定済みのため account filter 不要。
    const allBindings: unknown[] = [];
    if (lineAccountId) allBindings.push(lineAccountId, lineAccountId);
    allBindings.push(...conditionBindings);
    if (useCursor) allBindings.push(beforeAt, beforeAt, beforeId);
    allBindings.push(limit);
    const result = await c.env.DB.prepare(sql).bind(...allBindings).all();

    let data = result.results.map((ch: Record<string, unknown>) => ({
      id: ch.id as string,
      friendId: ch.friend_id,
      friendName: ch.display_name || '名前なし',
      friendPictureUrl: ch.picture_url || null,
      operatorId: ch.operator_id,
      status: ch.status,
      notes: ch.notes,
      lastMessageAt: ch.last_message_at,
      lastMessageContent: ch.last_message_content || null,
      lastMessageDirection: ch.last_message_direction || null,
      lastMessageType: ch.last_message_type || null,
      createdAt: ch.created_at,
      updatedAt: ch.updated_at,
    }));

    if (unansweredMap) {
      // 未対応 row の preview / timestamp で上書きして Inbox と一貫させる
      data = data
        .filter((row) => unansweredMap!.has(row.id as string))
        .map((row) => {
          const u = unansweredMap!.get(row.id as string)!;
          return {
            ...row,
            lastMessageAt: u.lastIncomingAt,
            lastMessageContent: u.lastIncomingType === 'text' ? u.lastIncomingContent : null,
            lastMessageDirection: 'incoming' as const,
            lastMessageType: u.lastIncomingType,
          };
        })
        // 上書きで lastMessageAt が変わったので resort
        .sort((a, b) => {
          const aAt = typeof a.lastMessageAt === 'string' ? a.lastMessageAt : '';
          const bAt = typeof b.lastMessageAt === 'string' ? b.lastMessageAt : '';
          return bAt.localeCompare(aAt);
        });
    }

    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/chats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.get('/api/chats/:id', async (c) => {
  try {
    const rawId = c.req.param('id');

    // id は chats.id または friend.id のどちらでもOK。
    // 優先順: chats.id 一致 → friend.id のとき chats.friend_id 最新行 → 何も無ければ friend のみで synthetic
    let chatRow = await getChatById(c.env.DB, rawId);
    let friendId: string | null = null;

    if (!chatRow) {
      const friendRow = await getFriendById(c.env.DB, rawId);
      if (!friendRow) return c.json({ success: false, error: 'Chat not found' }, 404);
      friendId = friendRow.id;
      // 同じ friend に紐づく chats 行があれば採用（lazy-create 後の再読みで status/notes を拾うため）
      const existing = await c.env.DB
        .prepare(`SELECT * FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1`)
        .bind(friendRow.id)
        .first<{ id: string; friend_id: string; operator_id: string | null; status: string; notes: string | null; last_message_at: string | null; created_at: string; updated_at: string }>();
      if (existing) {
        chatRow = existing as Awaited<ReturnType<typeof getChatById>>;
      }
    }

    const resolvedFriendId = chatRow?.friend_id ?? friendId!;
    // 公開 ID は常に friend_id に統一する（lazy-create で ID が変わるのを防ぐため）。
    const responseId = resolvedFriendId;
    const operatorId = chatRow?.operator_id ?? null;
    const status = chatRow?.status ?? 'resolved';
    const notes = chatRow?.notes ?? null;
    const lastMessageAt = chatRow?.last_message_at ?? null;
    const createdAt = chatRow?.created_at ?? null;

    const friend = await c.env.DB
      .prepare(`SELECT display_name, picture_url, line_user_id FROM friends WHERE id = ?`)
      .bind(resolvedFriendId)
      .first<{ display_name: string | null; picture_url: string | null; line_user_id: string }>();

    // 新しい1000件を取って昇順に戻す。LIMIT 200 ASC だと古い200件だけで broadcast/scenario 等の
    // 新しい push が欠落していた（Shu で 481件中 281件欠落のバグあり）。一覧側と同様に test 配信は除外。
    // 現状の最重量ユーザー(481件)の2倍バッファ。これ以上の履歴はページング未実装（Phase 2 TODO）。
    const messages = await c.env.DB
      .prepare(
        `SELECT id, friend_id, direction, message_type, content, created_at
         FROM messages_log
         WHERE friend_id = ? AND (delivery_type IS NULL OR delivery_type != 'test')
         ORDER BY created_at DESC LIMIT 1000`,
      )
      .bind(resolvedFriendId)
      .all();
    messages.results = (messages.results as Record<string, unknown>[]).reverse();

    return c.json({
      success: true,
      data: {
        id: responseId,
        friendId: resolvedFriendId,
        friendName: friend?.display_name || '名前なし',
        friendPictureUrl: friend?.picture_url || null,
        operatorId,
        status,
        notes,
        lastMessageAt,
        createdAt,
        messages: (messages.results as Record<string, unknown>[]).map((m) => ({
          id: m.id,
          direction: m.direction,
          messageType: m.message_type,
          content: m.content,
          createdAt: m.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/chats/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.post('/api/chats', async (c) => {
  try {
    const body = await c.req.json<{ friendId: string; operatorId?: string; lineAccountId?: string | null }>();
    if (!body.friendId) return c.json({ success: false, error: 'friendId is required' }, 400);
    const item = await createChat(c.env.DB, body);
    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE chats SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, item.id).run();
    }
    return c.json({ success: true, data: { id: item.id, friendId: item.friend_id, status: item.status } }, 201);
  } catch (err) {
    console.error('POST /api/chats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// チャットのアサイン/ステータス更新/ノート更新
chats.put('/api/chats/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const resolved = await resolveOrCreateChat(c.env.DB, id);
    if (!resolved) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ operatorId?: string | null; status?: string; notes?: string }>();
    await updateChat(c.env.DB, resolved.id, body);
    const updated = await getChatById(c.env.DB, resolved.id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      // 公開 ID は friend_id に統一
      data: { id: updated.friend_id, friendId: updated.friend_id, operatorId: updated.operator_id, status: updated.status, notes: updated.notes },
    });
  } catch (err) {
    console.error('PUT /api/chats/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// オペレーター入力中のローディング表示を開始
chats.post('/api/chats/:id/loading', async (c) => {
  try {
    const chatId = c.req.param('id');
    const chat = await resolveOrCreateChat(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    let loadingSecondsInput: number | undefined;
    try {
      const body = await c.req.json<{ loadingSeconds?: number }>();
      loadingSecondsInput = body.loadingSeconds;
    } catch {
      loadingSecondsInput = undefined;
    }
    const loadingSeconds = clampLoadingSeconds(loadingSecondsInput);

    const { friend, accessToken } = await resolveFriendAndAccessToken(
      c.env.DB,
      chat.friend_id,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
    );
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    await startLoadingAnimation(
      accessToken,
      friend.line_user_id,
      loadingSeconds,
    );

    return c.json({ success: true, data: { started: true, loadingSeconds } });
  } catch (err) {
    console.error('POST /api/chats/:id/loading error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return c.json({ success: false, error: message }, 500);
  }
});

// オペレーターからメッセージ送信
chats.post('/api/chats/:id/send', async (c) => {
  try {
    const chatId = c.req.param('id');
    const chat = await resolveOrCreateChat(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    const body = await c.req.json<{ messageType?: string; content: string }>();
    if (!body.content) return c.json({ success: false, error: 'content is required' }, 400);

    const { friend, accessToken } = await resolveFriendAndAccessToken(
      c.env.DB,
      chat.friend_id,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
    );
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    // LINE APIでメッセージ送信
    const { LineClient } = await import('@line-crm/line-sdk');
    const lineClient = new LineClient(accessToken);
    const messageType = body.messageType ?? 'text';

    if (messageType === 'text') {
      await lineClient.pushTextMessage(friend.line_user_id, body.content);
    } else if (messageType === 'flex') {
      const contents = JSON.parse(body.content);
      await lineClient.pushFlexMessage(friend.line_user_id, extractFlexAltText(contents), contents);
    } else if (messageType === 'image') {
      const parsed = JSON.parse(body.content) as {
        originalContentUrl: string;
        previewImageUrl: string;
      };
      await lineClient.pushImageMessage(
        friend.line_user_id,
        parsed.originalContentUrl,
        parsed.previewImageUrl,
      );
    }

    // メッセージログに記録
    const logId = crypto.randomUUID();
    await c.env.DB
      .prepare(`INSERT INTO messages_log (id, friend_id, direction, message_type, content, source, created_at) VALUES (?, ?, 'outgoing', ?, ?, 'manual', ?)`)
      .bind(logId, friend.id, messageType, body.content, jstNow())
      .run();

    // チャットの最終メッセージ日時を更新（chat.id を直接使う — friend_id で呼ばれても resolveOrCreateChat 済み）
    await updateChat(c.env.DB, chat.id, { status: 'in_progress', lastMessageAt: jstNow() });

    return c.json({ success: true, data: { sent: true, messageId: logId } });
  } catch (err) {
    console.error('POST /api/chats/:id/send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { chats };
